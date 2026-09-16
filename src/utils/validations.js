const Joi = require("joi");
const { ROLE, GENDER, INTERESTS } = require("../constants");

const sendOtpSchema = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().required(),
}).unknown(false);

const loginSchema = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().required(),
  password: Joi.string().min(1).max(128).required(),
}).unknown(false);


const adminCreateCreatorSchema = Joi.object({
  image: Joi.string().allow("").optional(),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  username: Joi.string().required(),
  password: Joi.string().required(),
  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .min(1)
    .required(),
  isAdult: Joi.boolean().valid(true).required().messages({
    "any.only": "You must confirm you are 18 years or above",
  }),
  dateOfBirth: Joi.date()
    .max("now")
    .max(new Date(new Date().setFullYear(new Date().getFullYear() - 18)))
    .required()
    .messages({
      "date.max": "You must be at least 18 years old to sign up",
      "date.base": "Enter a valid date of birth",
    }),
  location: Joi.object({
    type: Joi.string().valid("Point").default("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2).optional(),
    city: Joi.string().trim().allow("").optional(),
    state: Joi.string().trim().allow("").optional(),
    country: Joi.string().trim().allow("").optional(),
  }).optional(),

  gender: Joi.string()
    .valid(...Object.values(GENDER))
    .required(),
  phoneNumber: Joi.string().allow("").optional(),
  freeMonths: Joi.number().integer().min(1).max(12).optional(),
}).unknown(false);

const updateProfileSchema = Joi.object({
  image: Joi.string().allow("").optional(),
  coverImage: Joi.string().allow("").optional(),
  firstName: Joi.string().allow("").optional(),
  lastName: Joi.string().allow("").optional(),
  phoneNumber: Joi.string().allow("").optional(),
  tagLine: Joi.string().allow("").optional(),
  bio: Joi.string().allow("").optional(),
  gender: Joi.string()
    .valid(...Object.values(GENDER))
    .optional(),
  dateOfBirth: Joi.date()
    .max("now")
    .max(new Date(new Date().setFullYear(new Date().getFullYear() - 18)))
    .optional()
    .messages({
      "date.max": "You must be at least 18 years old to sign up",
      "date.base": "Enter a valid date of birth",
    }),
  location: Joi.object({
    type: Joi.string().valid("Point").default("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2).optional(),
    city: Joi.string().trim().allow("").optional(),
    state: Joi.string().trim().allow("").optional(),
    country: Joi.string().trim().allow("").optional(),
  }).optional(),

  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .optional(),
}).unknown(false);

const updateEmailSchema = Joi.object({
  email: Joi.string().email().required(),
}).unknown(false);

const updateUsernameSchema = Joi.object({
  username: Joi.string().required(),
}).unknown(false);

const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required(),
  confirmNewPassword: Joi.string().required(),
}).unknown(false);

const checkUsernameAvailabilitySchema = Joi.object({
  username: Joi.string().required(),
}).unknown(false);

const suggestUsernameSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
}).unknown(false);

const createUserSchema = Joi.object({
  image: Joi.string().allow("").required(),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  username: Joi.string().required(),
  otp: Joi.string().required(),
  password: Joi.string().required(),
  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .min(1)
    .required(),
  isAdult: Joi.boolean().valid(true).required().messages({
    "any.only": "You must confirm you are 18 years or above",
  }),
  dateOfBirth: Joi.date()
    .max("now")
    .max(new Date(new Date().setFullYear(new Date().getFullYear() - 18)))
    .required()
    .messages({
      "date.max": "You must be at least 18 years old to sign up",
      "date.base": "Enter a valid date of birth",
    }),
  gender: Joi.string()
    .valid(...Object.values(GENDER))
    .required(),
  location: Joi.object({
    type: Joi.string().valid("Point").default("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2).optional(),
    city: Joi.string().trim().allow("").optional(),
    state: Joi.string().trim().allow("").optional(),
    country: Joi.string().trim().allow("").optional(),
  }).optional(),
}).unknown(false);

const followUserSchema = Joi.object({
  userId: Joi.string().required(),
}).unknown(false);

const uploadMediaSchema = Joi.object({
  url: Joi.string().required(),
  publicId: Joi.string().required(),
  type: Joi.string().valid("photo", "video").required(),
  thumbnail: Joi.string().allow("").optional(),
  thumbnailPublicId: Joi.string().allow("").optional(),
  caption: Joi.string().allow("").optional(),
  size: Joi.number().optional(),
  duration: Joi.number().optional(),
}).unknown(false);

const addFavouriteSchema = Joi.object({
  favouriteUserId: Joi.string().required(),
}).unknown(false);

const likePostSchema = Joi.object({
  postId: Joi.string().required(),
}).unknown(false);

const createPostSchema = Joi.object({
  caption: Joi.string().allow("").optional(),
  media: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        mediaType: Joi.string().valid("image", "video", "gif").required(),
      }),
    )
    .optional(),
  scheduledAt: Joi.date().greater("now").optional(),
  dealId: Joi.string().hex().length(24).optional(),
  contentType: Joi.string().valid("post", "reel").default("post").optional(),
  taggedUsers: Joi.array()
    .items(Joi.string().hex().length(24))
    .max(20)
    .optional(),
  // visibility: Joi.string().valid("public", "followers", "private").required(),
})
  .or("caption", "media")
  .unknown(false);

const updatePostSchema = Joi.object({
  caption: Joi.string().allow("").optional(),
  media: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        mediaType: Joi.string().valid("image", "video", "gif").required(),
      }),
    )
    .optional(),
  visibility: Joi.string().valid("public", "followers", "private").optional(),
  scheduledAt: Joi.date().greater("now").optional(),
  taggedUsers: Joi.array()
    .items(Joi.string().hex().length(24))
    .max(20)
    .optional(),
})
  .or("caption", "media", "visibility", "scheduledAt", "taggedUsers")
  .unknown(false);

const createStorySchema = Joi.object({
  media: Joi.string().required(),
  mediaType: Joi.string().valid("image", "video").required(),
  dealId: Joi.string().hex().length(24).optional(),
}).unknown(false);

const buySubscriptionSchema = Joi.object({
  planId: Joi.string().required(),
  paymentIntentId: Joi.string().required(),
}).unknown(false);

const dismissFollowSuggestionSchema = Joi.object({
  dismissedUserId: Joi.string().required(),
}).unknown(false);

const sharePostSchema = Joi.object({
  postId: Joi.string().required(),
  recipientIds: Joi.array().items(Joi.string()).required(),
}).unknown(false);

const updateProfileUsernameSchema = Joi.object({
  username: Joi.string()
    .trim()
    .min(3)
    .max(30)
    .pattern(/^[a-zA-Z0-9_.]+$/)
    .required()
    .messages({
      "string.pattern.base":
        "Username can only contain letters, numbers, underscore (_) and dot (.)",
      "string.min": "Username must be at least 3 characters long",
      "string.max": "Username cannot exceed 30 characters",
      "string.empty": "Username is required",
      "any.required": "Username is required",
    }),
}).unknown(false);

const createExclusiveContentSchema = Joi.object({
  isExclusive: Joi.boolean().default(true),
  title: Joi.string().trim().required(),
  caption: Joi.string().trim().required(),
  tags: Joi.array().optional(),
  media: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        mediaType: Joi.string().valid("image", "video", "gif").required(),
      }),
    )
    .required(),
  visibility: Joi.string().valid("exclusive").required(),
}).unknown(false);

const updateExclusiveContentSchema = Joi.object({
  title: Joi.string().trim().optional(),
  caption: Joi.string().trim().optional(),
  tags: Joi.array().optional(),
  media: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        mediaType: Joi.string().valid("image", "video", "gif").required(),
      }),
    )
    .optional(),
}).unknown(false);

const createCreatorSubscriptionSchema = Joi.object({
  price: Joi.number().min(1).max(99).required(),
}).unknown(false);

const createCampaignObjectiveSchema = Joi.object({
  icon: Joi.string().trim().required(),
  name: Joi.string().trim().lowercase().min(2).max(60).required(),
  description: Joi.string().trim().min(10).max(150).required(),
}).unknown(false);

const updateCampaignObjectiveSchema = Joi.object({
  icon: Joi.string().trim().optional(),
  name: Joi.string().trim().lowercase().min(2).max(60).optional(),
  description: Joi.string().trim().min(10).max(150).optional(),
}).unknown(false);

const createCampaignCategorySchema = Joi.object({
  name: Joi.string().trim().lowercase().min(2).max(60).required(),
}).unknown(false);

const updateCampaignCategorySchema = Joi.object({
  name: Joi.string().trim().lowercase().min(2).max(60).optional(),
}).unknown(false);

// ---- Advertisement sub-schema (reusable) ----
const advertisementSchema = Joi.object({
  media: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        mediaType: Joi.string().valid("image", "video").required(),
      }),
    )
    .required(),
  headline: Joi.string().min(2).max(60).required(),
  primaryText: Joi.string().min(2).max(300).required(),
  callToAction: Joi.string()
    .valid(
      "shop_now",
      "learn_more",
      "sign_up",
      "book_now",
      "get_offer",
      "download",
      "subscribe",
    )
    .required(),
  designationUrl: Joi.string().required(),
});

// ---- CREATE (Add) Schema ----
const createCampaignSchema = Joi.object({
  objective: Joi.string().hex().length(24).required(), // ObjectId
  category: Joi.string().hex().length(24).required(), // ObjectId

  name: Joi.string().min(2).max(60).lowercase().trim().required(),
  brand: Joi.string().min(2).max(60).trim().required(),
  description: Joi.string().min(3).max(300).trim().allow("", null).optional(),

  // creators: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),

  location: Joi.object({
    type: Joi.string().valid("Point").default("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2).required(), // [longitude, latitude]
  }).required(),

  gender: Joi.array().items(Joi.string().valid(...Object.values(GENDER))).required(),

  ageRange: Joi.object({
    min: Joi.number().min(0).max(100).default(0),
    max: Joi.number().min(0).max(100).default(100),
  })
    .custom((value, helpers) => {
      if (value.min > value.max) {
        return helpers.message(
          "ageRange.min cannot be greater than ageRange.max",
        );
      }
      return value;
    })
    .optional(),

  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .min(1)
    .required(),

  budgetType: Joi.string().valid("daily", "lifetime").required(),
  dailyBudget: Joi.number().positive().required(),
  radiusInKm: Joi.number().positive().min(1).max(500).default(50),

  // ---- Schedule fields ----
  launchType: Joi.string()
    .valid("immediate", "scheduled")
    .default("immediate")
    .required(),

  startDateTime: Joi.date()
    .iso()
    .when("launchType", {
      is: "scheduled",
      then: Joi.date().greater("now").required().messages({
        "date.greater":
          "Start date/time must be in the future for scheduled campaigns.",
        "any.required":
          "Start date/time is required when launchType is 'scheduled'.",
      }),
      otherwise: Joi.optional(),
    }),

  endDateTime: Joi.date()
    .iso()
    .required()
    .when("launchType", {
      is: "scheduled",
      then: Joi.date().greater(Joi.ref("startDateTime")).messages({
        "date.greater": "End date/time must be after the start date/time.",
      }),
      otherwise: Joi.date().greater("now").messages({
        "date.greater": "End date/time must be after the current time.",
      }),
    }),

  advertisement: advertisementSchema.required(),

  paymentMethodId: Joi.string().required(),
}).unknown(false);

// ---- UPDATE (Edit) Schema ----
const updateCampaignSchema = Joi.object({
  objective: Joi.string().hex().length(24),
  category: Joi.string().hex().length(24),

  name: Joi.string().min(2).max(60).lowercase().trim(),
  brand: Joi.string().min(2).max(60).trim(),
  description: Joi.string().min(10).max(300).trim().allow("", null).optional(),

  // creators: Joi.array().items(Joi.string().hex().length(24)).min(1),

  location: Joi.object({
    type: Joi.string().valid("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2),
  }),

  gender: Joi.array().items(Joi.string().valid(...Object.values(GENDER))).optional(),

  ageRange: Joi.object({
    min: Joi.number().min(0).max(100),
    max: Joi.number().min(0).max(100),
  }).custom((value, helpers) => {
    if (
      value.min !== undefined &&
      value.max !== undefined &&
      value.min > value.max
    ) {
      return helpers.message(
        "ageRange.min cannot be greater than ageRange.max",
      );
    }
    return value;
  }),

  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .optional(),

  radiusInKm: Joi.number().positive().min(1).max(500).optional(),

  // budgetType: Joi.string().valid("daily", "lifetime"),
  // dailyBudget: Joi.number().positive(),

  // launchType: Joi.string().valid("immediate", "scheduled"),

  // startDateTime: Joi.date()
  //   .iso()
  //   .when("launchType", {
  //     is: "scheduled",
  //     then: Joi.date().greater("now").messages({
  //       "date.greater":
  //         "Start date/time must be in the future for scheduled campaigns.",
  //     }),
  //     otherwise: Joi.optional(),
  //   }),

  // endDateTime: Joi.date()
  //   .iso()
  //   .when("startDateTime", {
  //     is: Joi.exist(),
  //     then: Joi.date().greater(Joi.ref("startDateTime")).messages({
  //       "date.greater": "End date/time must be after the start date/time.",
  //     }),
  //     otherwise: Joi.optional(),
  //   }),

  advertisement: advertisementSchema,
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided to update the campaign.",
  })
  .unknown(false);

const deliverableSchema = Joi.object({
  type: Joi.string().trim().valid("post", "reel", "stream", "story").required(),
  count: Joi.number().integer().min(1).default(1),
});

const createDealSchema = Joi.object({
  receiver: Joi.string().hex().length(24),
  title: Joi.string().trim().min(3).max(100).required(),
  brand: Joi.string().trim().min(3).max(100).required(),
  description: Joi.string().trim().min(10).max(300).allow("", null),
  amount: Joi.number().positive().precision(2).required(),
  deliverables: Joi.array().items(deliverableSchema).min(1).max(20).required(),
  deadline: Joi.date().greater("now").required(),
});

const dealPaymentSchema = Joi.object({
  paymentMethodId: Joi.string().required(),
});

const dealReviewSchema = Joi.object({
  rating: Joi.number().positive().min(1).max(5).required(),
  comment: Joi.string().trim().min(3).max(500).required(),
});

const adminVerifyIncompleteDealSchema = Joi.object({
  note: Joi.string().trim().max(500).optional().allow(""),
}).unknown(false);

const campaignEstimatedReachSchema = Joi.object({
  ageRange: Joi.object({
    min: Joi.number().min(0).max(100).default(0),
    max: Joi.number().min(0).max(100).default(100),
  })
    .custom((value, helpers) => {
      if (value.min > value.max) {
        return helpers.message(
          "ageRange.min cannot be greater than ageRange.max",
        );
      }
      return value;
    })
    .required(),
  gender: Joi.array()
    .items(Joi.string().valid(...Object.values(GENDER)))
    .min(1)
    .required(),
  location: Joi.object({
    type: Joi.string().valid("Point").default("Point"),
    coordinates: Joi.array().items(Joi.number()).length(2).required(),
  }).required(),
  interests: Joi.array()
    .items(Joi.string().valid(...Object.values(INTERESTS)))
    .min(1)
    .required(),
  radiusInKm: Joi.number().positive().max(500).default(50),
}).unknown(false);

const createFanbugIntentSchema = Joi.object({
  amount: Joi.number().positive().required(),
  message: Joi.string().trim().allow("").max(200).default(""),
}).unknown(false);

const confirmFanbugSchema = Joi.object({
  paymentIntentId: Joi.string().trim().required(),
}).unknown(false);

// ---- Boost (Boost Post) schemas ----
const estimateBoostReachSchema = Joi.object({
  budget: Joi.number().min(10).required().messages({
    "number.min": "budget must be at least 10",
    "number.base": "budget must be a number",
    "any.required": "budget is required",
  }),
  duration: Joi.number()
    .valid(3, 7, 14)
    .required()
    .messages({
      "any.only": "duration must be one of 3, 7, 14",
      "any.required": "duration is required",
    }),
}).unknown(false);

const boostAudienceSchema = Joi.object({
  countries: Joi.array()
    .items(Joi.string())
    .min(1)
    .required()
    .messages({
      "array.min": "audience.countries must be a non-empty array",
      "any.required": "audience.countries is required",
    }),
  interests: Joi.array()
    .items(Joi.string())
    .min(1)
    .required()
    .messages({
      "array.min": "audience.interests must be a non-empty array",
      "any.required": "audience.interests is required",
    }),
  ageRange: Joi.object({
    min: Joi.number().min(18).required(),
    max: Joi.number().required(),
  })
    .custom((value, helpers) => {
      if (value.min >= value.max) {
        return helpers.message(
          "audience.ageRange.min must be less than audience.ageRange.max",
        );
      }
      return value;
    })
    .required()
    .messages({
      "any.required": "audience.ageRange is required",
    }),
});

const createBoostSchema = Joi.object({
  postId: Joi.string().hex().length(24).required().messages({
    "string.hex": "postId must be a valid Mongo ID",
    "any.required": "postId is required",
  }),
  objective: Joi.string()
    .valid("engagement", "profile", "messages", "website")
    .required()
    .messages({
      "any.only":
        "objective must be one of engagement, profile, messages, website",
      "any.required": "objective is required",
    }),
  // websiteUrl required only when objective === 'website'
  websiteUrl: Joi.string().when("objective", {
    is: "website",
    then: Joi.string()
      .uri({ scheme: ["http", "https"] })
      .required()
      .messages({
        "any.required": "websiteUrl is required when objective is 'website'",
        "string.uri": "websiteUrl must be a valid http(s) URL",
      }),
    otherwise: Joi.optional().allow("", null),
  }),
  audienceMode: Joi.string()
    .valid("automatic", "custom")
    .required()
    .messages({
      "any.only": "audienceMode must be one of automatic, custom",
      "any.required": "audienceMode is required",
    }),
  duration: Joi.number()
    .valid(3, 7, 14)
    .required()
    .messages({
      "any.only": "duration must be one of 3, 7, 14",
      "any.required": "duration is required",
    }),
  budget: Joi.number().min(10).required().messages({
    "number.min": "budget must be at least 10",
    "number.base": "budget must be a number",
    "any.required": "budget is required",
  }),
  // audience required only when audienceMode === 'custom'
  audience: boostAudienceSchema.when("audienceMode", {
    is: "custom",
    then: Joi.required().messages({
      "any.required": "audience is required when audienceMode is 'custom'",
    }),
    otherwise: Joi.optional().allow(null),
  }),
}).unknown(false);

module.exports = {
  sendOtpSchema,
  loginSchema,
  updateProfileSchema,
  updateEmailSchema,
  updateUsernameSchema,
  updatePasswordSchema,
  checkUsernameAvailabilitySchema,
  suggestUsernameSchema,
  createUserSchema,
  followUserSchema,
  uploadMediaSchema,
  addFavouriteSchema,
  likePostSchema,
  createPostSchema,
  updatePostSchema,
  createStorySchema,
  buySubscriptionSchema,
  dismissFollowSuggestionSchema,
  sharePostSchema,
  updateProfileUsernameSchema,
  createExclusiveContentSchema,
  updateExclusiveContentSchema,
  createCreatorSubscriptionSchema,
  createCampaignObjectiveSchema,
  updateCampaignObjectiveSchema,
  createCampaignCategorySchema,
  updateCampaignCategorySchema,
  createCampaignSchema,
  updateCampaignSchema,
  campaignEstimatedReachSchema,
  createDealSchema,
  dealPaymentSchema,
  dealReviewSchema,
  adminVerifyIncompleteDealSchema,
  createFanbugIntentSchema,
  confirmFanbugSchema,
  estimateBoostReachSchema,
  createBoostSchema,
  adminCreateCreatorSchema,
};
