const express = require("express");

const router = express.Router();

const addressController = require("../controllers/addressController");
const authenticateToken = require("../middleware/authToken");

router.route("/").post(authenticateToken, addressController.AddAddress);
router
  .route("/:addressId")
  .put(authenticateToken, addressController.UpdateAddress);
router
  .route("/:addressId")
  .delete(authenticateToken, addressController.DeleteAddress);
router
  .route("/:addressId")
  .get(authenticateToken, addressController.GetAddresses);
router.route("/").get(authenticateToken, addressController.ListAddresses);

module.exports = router;
