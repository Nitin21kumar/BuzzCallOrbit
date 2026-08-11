"""
One-time migration: assigns a `created_by` owner to any campaign, WhatsApp
campaign, voice folder, or STT record that was created BEFORE per-user data
ownership existed in this app.

Why this is needed: as of this update, every list endpoint only shows a
plain "user" role their OWN records (created_by == their uid); admin/
super_admin still see everything regardless. Old records have no
created_by field at all, so they simply don't match anyone's filter and
become invisible to non-admin accounts (nothing is deleted — admins can
always still see them).

Run this ONCE after deploying, to hand that old data to a specific owner
(so a non-admin can see it going forward too) instead of leaving it
admin-only forever.

Usage:
    cd backend
    python3 scripts/backfill_created_by.py --uid <firebase-uid-of-owner>
    python3 scripts/backfill_created_by.py --email someone@example.com

    # See what WOULD change without touching the database:
    python3 scripts/backfill_created_by.py --uid <uid> --dry-run
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

from app.database import (
    campaigns_collection, voice_folders_collection, stt_collection,
    whatsapp_campaigns_collection, users_collection,
)

COLLECTIONS = {
    "campaigns": campaigns_collection,
    "voice_folders": voice_folders_collection,
    "stt": stt_collection,
    "whatsapp_campaigns": whatsapp_campaigns_collection,
}


def resolve_uid(args) -> str:
    if args.uid:
        return args.uid
    user = users_collection.find_one({"email": args.email})
    if not user:
        print(f"No user found with email {args.email!r}. Check the address or use --uid instead.")
        sys.exit(1)
    print(f"Resolved {args.email!r} -> uid {user['uid']!r} (role: {user['role']})")
    return user["uid"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    owner = parser.add_mutually_exclusive_group(required=True)
    owner.add_argument("--uid", help="Firebase UID to assign old records to")
    owner.add_argument("--email", help="Email of the user to assign old records to (looked up in the users collection)")
    parser.add_argument("--dry-run", action="store_true", help="Show counts without writing anything")
    args = parser.parse_args()

    target_uid = resolve_uid(args)

    print(f"\n{'DRY RUN - ' if args.dry_run else ''}Assigning ownerless records to uid={target_uid}\n")
    total = 0
    for name, collection in COLLECTIONS.items():
        missing_filter = {"created_by": {"$exists": False}}
        count = collection.count_documents(missing_filter)
        if count == 0:
            print(f"  {name:20s} 0 records need updating")
            continue
        if args.dry_run:
            print(f"  {name:20s} {count} record(s) WOULD be updated")
        else:
            result = collection.update_many(missing_filter, {"$set": {"created_by": target_uid}})
            print(f"  {name:20s} {result.modified_count} record(s) updated")
        total += count

    print(f"\n{'Would update' if args.dry_run else 'Updated'} {total} record(s) total.")
    if args.dry_run and total:
        print("Re-run without --dry-run to actually apply this.")


if __name__ == "__main__":
    main()
