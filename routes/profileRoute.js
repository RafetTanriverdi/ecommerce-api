const express = require('express');

const router = express.Router();

const profileController = require('../controllers/profileController');
const authenticateToken = require('../middleware/authToken');

router.route('/').get(authenticateToken, profileController.GetProfile);
router.route('/').patch(authenticateToken, profileController.UpdateProfile);

module.exports = router;