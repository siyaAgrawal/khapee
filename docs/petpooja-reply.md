# Reply to Petpooja — short version, ready to send

> Says nothing about how many restaurants we have beyond "early", names no
> restaurant, and still asks for the one thing we actually want: sandbox
> credentials. Being straight about being early reads better to a partner than
> a vague number they will ask you to break down.

---

**Subject:** Re: Khapee × Petpooja — API access

Hi Pratik,

Thank you — I have been through the documentation and it covers our workflow.
Noted that Fetch Menu is deprecated; we will use Menu Push.

We would use Save Order with `order_type: D` and `table_no`, the Order
Callback to reflect the restaurant's accept or reject back to the customer,
Menu Push, and the in-stock/out-of-stock APIs.

Two questions:

1. For `order_type: D`, should `table_no` match the table names configured in
   the restaurant's own Petpooja table view, and is there an API that returns
   that list?
2. Can a dine-in order be marked as already paid, so the POS does not ask for
   payment again at the counter when the customer has paid by UPI in our app?

On your questions:

1. **Coverage.** Indore, Madhya Pradesh.
2. **Business.** Khapee is QR ordering for dine-in. The customer scans the
   code on their table, orders from their own phone, and the restaurant
   accepts and prints the KOT and bill. We are not a delivery aggregator and
   take no commission — the restaurant is paid directly, by UPI into their own
   account or cash at the counter.
3. **Onboarding.** We are early, working with restaurants in Indore, and
   growing. Several of them already run Petpooja, which is exactly why we want
   our orders to land inside the system they already use rather than beside
   it.

Could you share sandbox credentials — `app_key`, `app_secret`, `access_token`
and a test `restID` — so we can build and certify the integration? We will
send our Menu Push and Order Callback endpoint URLs at the same time, and can
map live restaurants once it is signed off.

Happy to get on a call if that is quicker.

Best regards,

**[YOUR NAME]**
Khapee — khapee.com
