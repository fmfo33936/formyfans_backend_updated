const Message = require("../models/message");

const getAllMessagesForUser = async (req, res) => {
  const message = await Message.find({ conversationId: req.params.id })
    .populate({
      path: "sharedPost.postId",
      select: "_id caption media authorId",
      populate: {
        path: "authorId",
        select: "_id image firstName lastName username",
      },
    })
    .populate({
      path: "sharedDeal.dealId",
      select: "_id title brand amount description deadline deliverables currency paymentType status",
    })
    .populate({
      path: "sharedCampaign.campaignId",
      select:
        "_id brand name description advertisement endDateTime startDateTime likesCount commentsCount sharesCount",
    })
    .sort({ timestamp: 1 })
    .lean();

  res.status(200).send({
    status: "success",
    data: message,
    message: "Messages fetched successfully",
  });
};

module.exports = {
  getAllMessagesForUser,
};
