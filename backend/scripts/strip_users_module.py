"""
One-time cleanup: removes the "users" (User Management) module from any
existing role="user" account that has it — left over from testing before
this restriction was added to the app (User Management is now always
admin/super_admin-only; a plain "user" account should never see it).

This does NOT touch super_admin or admin accounts, and does NOT touch any
other module a user has been granted — it only ever removes "users" if
present, nothing else.

Usage:
    cd backend
    python3 scripts/strip_users_module.py            # apply the fix
    python3 scripts/strip_users_module.py --dry-run   # preview only
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

from app.database import users_collection


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Show who would be affected without changing anything")
    args = parser.parse_args()

    affected = list(users_collection.find({"role": "user", "modules": "users"}))

    if not affected:
        print("Nothing to fix — no plain 'user' account currently has the 'users' module.")
        return

    print(f"{'Would fix' if args.dry_run else 'Fixing'} {len(affected)} account(s):")
    for doc in affected:
        print(f"  - {doc.get('email', doc['uid'])} (uid={doc['uid']})")

    if args.dry_run:
        print("\nRe-run without --dry-run to actually apply this.")
        return

    result = users_collection.update_many(
        {"role": "user", "modules": "users"},
        {"$pull": {"modules": "users"}},
    )
    print(f"\nDone — updated {result.modified_count} account(s).")


if __name__ == "__main__":
    main()
