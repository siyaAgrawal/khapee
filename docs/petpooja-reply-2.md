# Reply to Petpooja — answering the KOT question

> Answers their one question directly, confirms the single thing our bill
> depends on, and asks again for the sandbox credentials — which they still
> have not sent, and which are the only real blocker left.

---

**Subject:** Re: Khapee × Petpooja — API access

Hi Pratik,

Thank you — both answers are what we needed.

On your question: **multiple KOTs per table.** A dine-in table with us runs a
couple of hours — drinks, then starters, then somebody's friend arrives and
orders again. Each of those rounds goes to the kitchen on its own, and the
table is settled once at the end.

So your model fits ours. We will send each round as a separate order carrying
the same `table_no`, giving one KOT per order on your side. One confirmation,
because our bill depends on it: when several orders sit against the same
`table_no`, does Petpooja settle them as a **single bill** at the counter, or
does each order bill separately?

Two smaller ones:

1. Which `payment_type` should a UPI-paid order use? You mentioned Cash, Card,
   COD and Other. Is `ONLINE` also accepted, or should a prepaid UPI order go
   as Other with the reference in the payment details?
2. In the Menu API table details, which field is the table name we should send
   back as `table_no`?

And the one still outstanding from before: could you share sandbox `app_key`,
`app_secret`, `access_token` and a test `restID`, plus the production base URL
for our integration? Our Menu Push and Order Callback endpoints are built — we
can send you the URLs as soon as there is somewhere to certify against.

Best regards,

Siya
Khapee — khapee.com
