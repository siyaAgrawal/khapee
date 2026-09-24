# Reply to Petpooja — ready to send

> **One blank before you send it:** how many Khapee restaurants already run
> Petpooja. I only know of Cafe Sukoon (Vijay Bhaiya, Saket), restID R156072.
> If that is the only one, say "one"; it is a perfectly good answer for a
> pilot. Everything else below is checked — the restaurant counts come from
> our own database, and every API claim is from their documentation.

---

**Subject:** Re: Khapee × Petpooja — API access for dine-in QR ordering

Hi Pratik,

Thank you for the documentation and for the quick reply. I have been through
it and can confirm it covers our workflow. Answers to your questions are
below, along with what we would need to get started.

## On the APIs

Noted that Fetch Menu is deprecated — we are not using it. Four of the APIs
cover what we need:

**Menu Push.** We will expose an endpoint for this, so a menu change made in
Petpooja reaches us without anyone retyping it. This is the part our
restaurants will feel first: today a price change has to be made twice.

**Save Order**, with `order_type: D` and `table_no`. This is the important one
for us, and the reason I wanted to confirm the documentation before replying.
We are dine-in rather than delivery: a customer scans the QR on their table,
orders from their own phone, and the order needs to reach the restaurant's
existing Petpooja POS with the table number on it — so the KOT and the bill
come off the printer they already use, in the format their staff already read.
We do not want to give a restaurant a second screen to watch or a second set
of numbers to reconcile at closing time.

**Order Callback.** We will implement this endpoint. Status `1/2/3` is what
tells the customer their order has been accepted, `-1` with `cancel_reason` is
what tells them it could not be taken and why, and `5` tells them it is ready.
Our app deliberately shows the customer nothing confirmed until the restaurant
has actually accepted — so this callback drives the entire customer-facing
side of the integration.

**Update Item/addon In Stock / Out of Stock.** So a dish marked off on the POS
disappears from the customer's menu immediately, rather than being ordered and
then refused.

Two questions on the detail:

1. For `order_type: D`, should `table_no` match the table names configured in
   the restaurant's own Petpooja table view? If so, is there an API that gives
   us that list? We currently hold our own table names against the QR codes on
   each table, and I would rather map them than have the two drift apart.
2. Can payment status be conveyed on a dine-in order — that is, can we mark an
   order as already paid when the customer has paid by UPI in our app, so the
   POS does not ask for payment a second time at the counter?

## 1. Service coverage

Indore, Madhya Pradesh. We are concentrated there deliberately while we get
the product right, and are expanding within the city before going anywhere
else.

## 2. Business overview

Khapee is QR ordering for dine-in restaurants. A customer scans the code on
their table, sees that restaurant's menu on their own phone, and orders
without waiting for a waiter or installing anything. The restaurant accepts
the order on a dashboard and prints the KOT and the bill.

We are not a delivery aggregator and we charge no commission on orders. The
restaurant is paid directly — UPI straight into their own account, or cash at
the counter — and we are not in the middle of the money at any point.

That is why this integration matters to us. The restaurants we work with
already run their day on Petpooja, and the right outcome is that our orders
simply appear in the system they already trust, rather than beside it.

## 3. Restaurant onboarding

27 restaurants are set up on Khapee, 17 of them with their full menus live.
All are in Indore.

Of those, **[NUMBER]** currently use Petpooja.

We would like to begin with a single pilot: **Cafe Sukoon (Vijay Bhaiya,
Saket)** — Petpooja restID **R156072** — and extend to the others once it has
run cleanly through a few services.

## What we need to start

Could you share staging credentials for that restaurant — `app_key`,
`app_secret`, `access_token` and the mapping `restID`? We will send you our
Menu Push and Order Callback endpoint URLs at the same time, and we are ready
to build against the sandbox as soon as we have them.

Happy to get on a call if it would be quicker than email.

Best regards,

**[YOUR NAME]**
Khapee — khapee.com
