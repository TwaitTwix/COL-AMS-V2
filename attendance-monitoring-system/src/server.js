import app from "./app.js";
import { env } from "./config/env.js";
import { initializeReportQueue } from "./services/report-service.js";

// Serving the login page must not wait for a remote database connection.
void initializeReportQueue().catch(error=>console.error('Report queue recovery failed:',error.message));

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Attendance API listening at http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Could not start: port ${env.PORT} is already in use. Close the other local server, or set a different PORT in .env.`);
  } else {
    console.error("Could not start the attendance server:", error.message);
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received; closing HTTP server`);
  server.close((error) => {
    if (error) {
      console.error("Error while closing server:", error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
