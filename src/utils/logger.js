const formatArgs = (args) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)));

const writeLog = (level, ...args) => {
  const timestamp = new Date().toISOString();
  const message = formatArgs(args).join(" ");
  console.info(`[${timestamp}] [${level}] ${message}`);
};

module.exports = {
  info: (...args) => writeLog("INFO", ...args),
  warn: (...args) => writeLog("WARN", ...args),
  error: (...args) => writeLog("ERROR", ...args),
};
