const express = require("express");
const {
  createLiveStream,
  listLiveStreams,
  getLiveStream,
  createJoinToken,
  endLiveStream,
  listLiveStreamComments,
  createLiveStreamComment,
} = require("../controllers/liveStream");
const {
  createFanbugIntent,
  confirmFanbug,
  listFanbugs,
} = require("../controllers/liveStreamPayment");
const {
  verifyUser,
  verifyContentCreator,
} = require("../middlewares/auth");

const router = express.Router();

router.get("/", verifyUser, listLiveStreams);
router.post("/", verifyContentCreator, createLiveStream);
router.get("/:streamId", verifyUser, getLiveStream);
router.post("/:streamId/token", verifyUser, createJoinToken);
router.post("/:streamId/end", verifyContentCreator, endLiveStream);
router.get("/:streamId/comments", verifyUser, listLiveStreamComments);
router.post("/:streamId/comments", verifyUser, createLiveStreamComment);
router.get("/:streamId/fanbugs", verifyUser, listFanbugs);
router.post("/:streamId/fanbugs/intent", verifyUser, createFanbugIntent);
router.post("/:streamId/fanbugs/confirm", verifyUser, confirmFanbug);

module.exports = router;
