const COPY = {
  IMAGE: {
    name: "image",
    start: "Your image is on its way! We're putting the first details together.",
    refine: "Finding the right colors, lighting, and little details for your image.",
    prepare: "Your idea is ready. We're setting up the final look.",
    render: "Your image is taking shape. This part can take a little while.",
    waiting: [
      "Still painting the details. Good things take a moment!",
      "Adding the finishing touches to your image.",
      "Almost there. We're making sure your image looks its best.",
    ],
    save: "Your image is ready. We're saving it for you now.",
    done: "Your image is ready! Take a look at what you made.",
    failed: "We couldn't finish your image this time. Please try again. If your credits look wrong, contact support.",
  },
  VIDEO: {
    name: "video",
    start: "Your video is on its way! We're setting the scene.",
    refine: "Shaping your idea into a story that moves.",
    prepare: "Getting the scenes, motion, and sound ready.",
    render: "Your video is coming to life. This can take a few minutes.",
    waiting: [
      "The scenes are still coming together. Stay with us!",
      "Adding motion and polishing the details of your video.",
      "Your video is still being created. We'll show it as soon as it's ready.",
    ],
    save: "Your video is made. We're saving it for you now.",
    done: "Your video is ready! Press play and enjoy.",
    failed: "We couldn't finish your video this time. Please try again. If your credits look wrong, contact support.",
  },
  VIDEO_EDIT: {
    name: "video edit",
    start: "Your video edit is on its way! We're looking over your clip.",
    refine: "Working out how to make the changes you asked for.",
    prepare: "Getting your original video and reference images ready.",
    render: "Your video is being transformed. This can take a few minutes.",
    waiting: [
      "Your edit is still underway. We're keeping the motion smooth.",
      "Blending the new look with your original video.",
      "Still polishing your edit. We'll show it as soon as it's ready.",
    ],
    save: "Your edit is made. We're saving the new video now.",
    done: "Your edited video is ready! See the transformation.",
    failed: "We couldn't finish your video edit this time. Please try again. If your credits look wrong, contact support.",
  },
};

const forType = (type) => COPY[type] || COPY.IMAGE;
const forProgress = (type, progress) => {
  const copy = forType(type);
  if (progress >= 85) return copy.save;
  if (progress >= 60) return copy.render;
  if (progress >= 40) return copy.prepare;
  if (progress >= 20) return copy.refine;
  return copy.start;
};

module.exports = { forType, forProgress };
