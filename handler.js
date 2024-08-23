const express = require("express");
const serverless = require("serverless-http");

const productRoute = require('./routes/productsRoute');
const checkoutRoute = require('./routes/checkoutRoute');
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

app.use('/products',productRoute);
app.use('/checkout',checkoutRoute);

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

exports.handler = serverless(app);
