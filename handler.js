const express = require("express");
const serverless = require("serverless-http");
const bodyParser = require("body-parser");

const productRoute = require("./routes/productsRoute");
const checkoutRoute = require("./routes/checkoutRoute");
const ordersRoute = require("./routes/ordersRoute");
const checkoutController = require("./controllers/checkoutController");
const categoriesRoute = require("./routes/categoriesRoute");
const profileRoute = require("./routes/profileRoute");
const addressRoute = require("./routes/addressRoute"); 

const app = express();

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

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

// Webhook Route with express.raw middleware
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "10mb" }),
  checkoutController.PostWebhook
);

app.use("/products", productRoute);
app.use("/checkout", checkoutRoute);
app.use("/orders", ordersRoute);
app.use("/categories", categoriesRoute);
app.use("/profile", profileRoute);
app.use("/address", addressRoute);

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

exports.handler = serverless(app);
