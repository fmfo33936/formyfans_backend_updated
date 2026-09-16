// jobs/publishScheduledPosts.js
const cron = require("node-cron");
const Post = require("../models/post");
const logger = require("../utils/logger");
const { logActivity } = require("../utils/activityLogger");

const publishScheduledPosts = async () => {
  const now = new Date();

  try {
    const duePosts = await Post.find({
      status: "scheduled",
      scheduledAt: { $lte: now },
    })
      .select("_id authorId taggedUsers")
      .populate("authorId", "firstName lastName username");

    if (duePosts.length === 0) return;

    const postIds = duePosts.map((p) => p._id);

    const result = await Post.updateMany(
      { _id: { $in: postIds } },
      { $set: { status: "published", publishedAt: now } },
    );

    logger.info(`Published ${result.modifiedCount} scheduled post(s)`);

    for (const post of duePosts) {
      try {
        await logActivity(null, {
          userId: post.authorId?._id ?? post.authorId,
          action: "post_published",
          targetType: "posts",
          targetId: post._id,
          meta: {
            message: "Your post has been published",
          },
        });

        // Send tag notifications now that the post is live. Immediate-publish
        // posts already received these in createPost; scheduled posts receive
        // them here so they arrive when the post is actually visible.
        if (Array.isArray(post.taggedUsers) && post.taggedUsers.length > 0) {
          const { createNotification } = require("../utils/notificationHelper");
          const author = post.authorId;
          const authorId = author?._id ?? author;
          if (!authorId) continue;

          const senderName =
            [author?.firstName, author?.lastName].filter(Boolean).join(" ").trim() ||
            author?.username ||
            "Someone";

          for (const tagged of post.taggedUsers) {
            await createNotification({
              recipientId: tagged.userId,
              senderId: authorId,
              type: "post_tagged",
              targetType: "posts",
              targetId: post._id,
              title: "Tagged in a post",
              message: `${senderName} tagged you in a post`,
              meta: { postId: post._id, authorId },
            });
          }
        }
      } catch (logError) {
        logger.error(
          `Failed to process publish for post ${post._id}: ${logError.message}`,
        );
      }
    }
  } catch (error) {
    logger.error(`Error publishing scheduled posts: ${error.message}`);
  }
};

const startScheduledPostCron = () => {
  cron.schedule("* * * * *", publishScheduledPosts);
  logger.info("Scheduled post publisher cron started");
};

module.exports = startScheduledPostCron;
