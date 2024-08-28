const express = require("express");
const router = express.Router();

const ordersController = require("../controllers/ordersController");
const authenticateToken = require("../middleware/authToken");

router.route("/").get(authenticateToken,ordersController.ListOrders);
router.route("/:orderId").get(authenticateToken,ordersController.GetOrder);


module.exports = router;
