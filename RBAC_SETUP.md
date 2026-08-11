# Role-Based Access Control — Setup Guide

RBAC system poora ban chuka hai (backend + frontend). Isko chalane ke liye
**do manual steps** karne hai — dono ek naye Firebase project se milte hai:
1. Frontend ka web config (`.env` file)
2. Backend ka Service Account key

Dono ke bina app chalegi nahi — frontend turant error dega agar `.env` missing
hai, aur backend login/signup pe 503 error dega agar service account key
missing hai (jaan-bujh kar aisa rakha hai, taaki galti se purana/galat
project connect na ho jaye).

## 1. Frontend ka web config (`.env`)

1. [Firebase Console](https://console.firebase.google.com) khol kar apna
   naya project select karo.
2. ⚙️ **Project Settings** → **General** tab → neeche scroll karke **Your apps**
   section me apni web app (`</>`) dhoondo (agar nahi bani to yahi se "Add app" → Web se bana lo).
3. Wahan dikhne wale `firebaseConfig` object ki values copy karo.
4. `frontend/.env.example` ko copy karke `frontend/.env` banao, aur usme
   values paste kar do:

```bash
cd frontend
cp .env.example .env
# ab .env file kholo aur VITE_FIREBASE_* values fill karo
```

5. Firebase Console me hi **Authentication** → **Sign-in method** tab me jaake
   **Email/Password** aur **Google** — dono providers enable karo (login page
   dono use karta hai).
6. **Authentication** → **Settings** → **Authorized domains** me apna real
   domain add karo (localhost already allowed hai testing ke liye).

## 2. Backend ka Service Account key

1. Usi Firebase project me: ⚙️ **Project Settings** → **Service Accounts** tab.
2. **Generate new private key** button dabao → ek `.json` file download hogi.
3. Us file ko rename karke `firebase-service-account.json` rakho aur
   `backend/` folder ke andar (jaha `main.py` hai, wahi level pe) daal do.

Bas itna hi — `backend/app/firebase_admin_client.py` khud isko dhoondh lega.
(Ye file secret hai, kabhi bhi git/GitHub pe commit mat karna — `.gitignore`
me already add kar diya hai, waise hi `.env` bhi git me nahi jayega.)

## 3. Backend chalao

```bash
cd backend
pip install -r requirements.txt --break-system-packages   # firebase-admin naya add hua hai
uvicorn main:app --reload
```

## 4. Pehla login = Super Admin

Sabse pehla jo bhi user is app me login/signup karega (naya Mongo `users`
collection khali hone ki wajah se), wo **automatically Super Admin** ban
jayega. Toh sabse pehle khud login karo — us user account se hi:
- naye Admins/Users banao
- unko modules/services/fields assign karo

Uske baad koi bhi naya self-signup (Google/email se seedha login karne wala)
default "User" role me aayega, jisme **saare modules dikhenge aur poore
app me kahi bhi jaa sakega** (view access), lekin **kuch bhi create/edit/
delete/trigger nahi kar payega** — koi button dabayega to "You don't have
access to..." wala clear error milega. Jab tak Admin/Super Admin unhe
specific actions (create/edit/delete waghera) explicitly assign na kare,
sirf dekh hi payega.

## 5. Naya user banane ka flow

Sidebar → **User Management** → **New User**:
- Naam + email dalo, role choose karo (Admin sirf "User" role de sakta hai;
  Super Admin, Admin ya User dono de sakta hai)
- Modules/Services/Fields checkboxes se select karo (sirf role="User" ke liye
  — Admin/Super Admin ko sab kuch automatically mil jata hai)
- Submit karte hi ek **one-time password-reset link** milega — wo link us
  naye user ko bhej do (WhatsApp/email/jaise bhi), wahan se wo apna khud ka
  password set kar lega.

## Notes

- Password kahi bhi apne DB me store nahi hota — Firebase khud securely
  handle karta hai. Mongo me sirf role/permissions store hote hai.
- Har API request pe backend Firebase token verify karta hai + Mongo se
  permissions check karta hai — sirf frontend pe UI chupana kaafi nahi tha,
  isliye backend bhi fully protected hai ab.
- Frontend ab kisi bhi purane/hardcoded Firebase project pe fallback nahi
  karta — `.env` na hone par app load hi nahi hogi (clear error dikhega),
  taaki accidentally purane project se connect na ho jaye.

