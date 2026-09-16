const Story = require("../models/story");
const Follow = require("../models/follow");
const Deal = require("../models/deal");
const { AUTHOR_FIELDS, sanitizeAuthor } = require("../utils/socialHelpers");
const { createStorySchema } = require("../utils/validations");
const { schemaValidator } = require("../utils/validator");

const activeStoryFilter = () => ({ expiresAt: { $gt: new Date() } });

const formatStory = async (story, userId) => {
  if (!story) return null;

  await story.populate([
    { path: "collaborators.userId", select: AUTHOR_FIELDS },
  ]);

  const doc = story.toObject ? story.toObject() : { ...story };

  const collaborators = (doc.collaborators ?? []).map((c) => ({
    userId: c.userId?._id ?? c.userId,
    user: c.userId?._id ? sanitizeAuthor(c.userId) : null,
  }));

  return {
    _id: doc._id,
    authorId: doc.authorId?._id ? doc.authorId._id : doc.authorId,
    author: doc.authorId?._id ? sanitizeAuthor(doc.authorId) : null,
    dealId: doc.dealId ?? null,
    contentType: "story",
    collaborators,
    media: doc.media ?? "",
    mediaType: doc.mediaType,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    updatedAt: doc.updatedAt,
  };
};

const createStory = async (req, res) => {
  const [error, validatedData] = schemaValidator(req.body, createStorySchema);
  if (error) return res.status(400).json({ status: "error", message: error });

  try {
    const userId = req.user._id;
    const contentType = "story"; // For deal deliverables, we treat stories as a content type
    const { dealId } = validatedData;

    // ---- Collaborative post: validate + register against the deal ----
    let deal = null;
    if (dealId) {
      deal = await Deal.findById(dealId);

      if (!deal) {
        return res
          .status(404)
          .json({ status: "fail", message: "Deal not found" });
      }

      if (deal.receiver.toString() !== userId.toString()) {
        return res.status(403).json({
          status: "fail",
          message: "You are not the receiver of this deal",
        });
      }

      if (deal.status !== "started") {
        // Covers exactly the case you described: deal already completed
        // (or cancelled/paused/etc) by the time the user tries to select it
        return res.status(400).json({
          status: "fail",
          message:
            deal.status === "completed"
              ? "This deal has already been completed"
              : `This deal is not currently active (status: ${deal.status})`,
        });
      }

      const deliverable = deal.deliverables.find((d) => d.type === contentType);
      if (!deliverable) {
        return res.status(400).json({
          status: "fail",
          message: `This deal has no "${contentType}" deliverable`,
        });
      }
      if (deliverable.completed >= deliverable.count) {
        return res.status(400).json({
          status: "fail",
          message: `All "${contentType}" deliverables for this deal are already fulfilled`,
        });
      }
      // if we get here, it's safe to create the post and bump the count
    }

    const story = await Story.create({
      authorId: userId,
      dealId: deal?._id || null,
      collaborators: deal ? [{ userId: deal.sender }] : [],
      ...validatedData,
    });

    // Bump the matching deliverable's completed count now that the story exists
    if (deal) {
      await deal.registerDeliverable(contentType);
    }

    await story.populate("authorId", AUTHOR_FIELDS);

    const formattedStory = await formatStory(story, userId);

    return res.status(200).json({
      status: "success",
      message: "Story created successfully",
      story: formattedStory,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

const getActiveStories = async (req, res) => {
  try {
    const userId = req.user._id;

    const following = await Follow.find({ followerId: userId }).select(
      "followingId",
    );
    const authorIds = [userId, ...following.map((f) => f.followingId)];

    const stories = await Story.find({
      authorId: { $in: authorIds },
      ...activeStoryFilter(),
    })
      .populate("authorId", AUTHOR_FIELDS)
      .sort({ createdAt: -1 });

    const grouped = {};
    for (const story of stories) {
      const authorKey = String(story.authorId._id || story.authorId);
      if (!grouped[authorKey]) {
        grouped[authorKey] = {
          author: sanitizeAuthor(story.authorId),
          stories: [],
        };
      }
      grouped[authorKey].stories.push(await formatStory(story, userId));
    }

    return res.status(200).json({
      message: "Active stories fetched successfully",
      storyGroups: Object.values(grouped),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getActiveStoriesByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const stories = await Story.find({
      authorId: userId,
      ...activeStoryFilter(),
    })
      .populate("authorId", AUTHOR_FIELDS)
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Active stories fetched successfully",
      stories: await Promise.all(
        stories.map((s) => formatStory(s, req.user?._id)),
      ),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createStory,
  getActiveStories,
  getActiveStoriesByUser,
};
