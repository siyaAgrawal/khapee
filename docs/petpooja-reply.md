# Reply to Petpooja — draft

> Two things need your answer before this goes: how many of our restaurants
> already run Petpooja (I only know of Cafe Sukoon / Vijay Bhaiya, R156072),
> and whether you want to quote 27 restaurants set up or 17 with full menus
> live. Both numbers are true; they say different things. Everything else
> below is checked against their documentation.

---

**Subject:** Re: Khapee × Petpooja — API access

Hi Pratik,

Thank you — I have been through the documentation and it covers our workflow
completely. Confirming that, and answering your questions below.

**On the APIs**

What we need maps onto four of them:

- **Menu Push** — we will expose an endpoint for it, so a menu change made in
  Petpooja reaches us without anybody retyping it. Noted that Fetch Menu is
  deprecated; we are not using it.
- **Save Order** with `order_type: D` and `table_no` — this is the important
  one for us. We are dine-in rather than delivery: a customer scans the QR on
  their table, orders from their phone, and the order needs to land on the
  restaurant's own POS with the table number on it, so the KOT and the bill
  come off their existing printer exactly as they do today.
- **Order Callback** — we will implement this endpoint. Status `1/2/3` is what
  tells the customer their order has been accepted, `-1` with `cancel_reason`
  is what tells them it could not be taken and why, and `5` is what tells them
  it is ready. Our app shows the customer nothing until the restaurant has
  actually accepted, so this callback is what drives the whole customer-facing
  side.
- **Update Item/addon In Stock / Out of Stock** — so a dish marked off on the
  POS disappears from the customer's menu immediately.

Two questions on the detail:

1. For `order_type: D`, is the `table_no` expected to match the table names
   configured in the restaurant's own Petpooja table view, and if so is there
   an API that gives us that list? We currently hold our own table names.
2. Is payment status conveyed on a dine-in order — that is, can we mark an
   order as already paid through UPI in our app, so the POS does not ask for
   payment a second time at the counter?

**1. Service coverage**

Indore, Madhya Pradesh. We are concentrated there deliberately while we get
the product right, and expanding within the city before any other.

**2. Business overview**

Khapee is QR ordering for dine-in restaurants. A customer scans the code on
their table, sees that restaurant's menu on their own phone, and orders
without waiting for a waiter or downloading anything. The restaurant gets the
order on a dashboard, accepts it, and prints the KOT and the bill.

We are not a delivery aggregator and we take no commission on orders. The
restaurant is paid directly — UPI straight into their own account, or cash at
the counter — and we are not in the middle of the money at any point.

The reason we want this integration is specific: the restaurants we work with
already run their day on Petpooja, and we do not want to give them a second
screen to watch or a second set of numbers to reconcile at closing time. We
would rather our orders arrived inside the system they already use.

**3. Restaurant onboarding**

[YOUR NUMBERS — see the note at the top]

We would like to start with one restaurant as a pilot: Cafe Sukoon (Vijay
Bhaiya, Saket) — Petpooja restID **R156072** — and extend to the rest once it
is running cleanly.

Could you share staging credentials (`app_key`, `app_secret`, `access_token`
and the mapping `restID`) so we can build against the sandbox? We will send
you our Menu Push and Order Callback endpoint URLs at the same time.

Best regards,
[YOUR NAME]
Khapee — khapee.com
