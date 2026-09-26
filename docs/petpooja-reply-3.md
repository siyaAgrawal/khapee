# Reply to Petpooja — the one that asks for the credentials plainly

> Answers their KOT question in two lines, then makes the ask impossible to
> miss by putting it in a numbered list of four concrete things. Everything
> else is context they can skip.

---

**Subject:** Re: Khapee × Petpooja — ready to certify, need sandbox credentials

Hi Pratik,

Thank you — that answers both questions.

**On your question about KOTs:** yes, multiple KOTs per table. A dine-in table
with us runs a couple of hours — drinks, then starters, then somebody's friend
arrives and orders again. We have built it exactly the way you described: each
round is sent as a **separate order carrying the same `table_no`**, so it
becomes one KOT per order on your side. The table is settled once at the end.

Our integration is complete and tested against your documentation. We are
sending Save Order (with tax and `table_no`), and we accept Menu Push, Item
Stock, Store Status and Order Callback. Table details are read from the Menu
API as you advised.

**To finish, we need four things from you:**

1. **Sandbox credentials** — `app_key`, `app_secret`, `access_token`
2. **A test `restID`** we can push orders to
3. **The production base URL** for our integration (the docs only list the
   staging endpoints)
4. **Registration of our four webhook URLs** on your side — we will send the
   exact URLs the moment you confirm, or sooner if you prefer

Once we have 1–3 we can certify within a day.

**Two smaller points, whenever convenient:**

- When several orders sit against the same `table_no`, does Petpooja settle
  them as a **single bill** at the counter, or does each order bill separately?
  Our final bill depends on this.
- For a dine-in order the customer has already paid by UPI in our app, which
  `payment_type` should we send? Your note listed Cash, Card, COD and Other —
  is `ONLINE` also accepted, or should a prepaid order go as Other? We want to
  be certain the POS does not ask the customer to pay a second time.

Happy to get on a call if that is quicker.

Best regards,

Siya
Khapee — khapee.com
