const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.PostCheckOutStripe = async (req, res) => {
  console.log("res", res);
  console.log("req", req);

  const priceId = req.body.priceId;
  const quantity = req.body.quantity;
  const success_url = req.body.success_url;
  const cancel_url = req.body.cancel_url;
  try {
    const session= await stripe.checkout.sessions.create({
      success_url: success_url,
      cancel_url: cancel_url,
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      mode: "payment",
    });
    console.log("session", session);
    res.redirect(303, session.url);
 } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};
