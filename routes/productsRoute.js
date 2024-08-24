const express = require("express");
const router = express.Router();

const productsController = require("../controllers/productsController");

router.route('/').get( productsController.ListProducts);
router.route('/:productId').get(productsController.GetProduct);
module.exports = router;