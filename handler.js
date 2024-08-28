const express = require("express");
const serverless = require("serverless-http");

const productRoute = require("./routes/productsRoute");
const checkoutRoute = require("./routes/checkoutRoute");
const ordersRoute = require("./routes/ordersRoute");
const checkoutController = require("./controllers/checkoutController");
const categoriesRoute = require("./routes/categoriesRoute");
const app = express();

app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

// Routes
app.post(
  "/webhook",
    express.raw({ type: 'application/json' }), // Ham JSON olarak alıyoruz
  checkoutController.PostWebhook
);

app.use("/products", productRoute);
app.use("/checkout", checkoutRoute);
app.use("/orders", ordersRoute);
app.use("/categories",categoriesRoute)

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

exports.handler = serverless(app);
