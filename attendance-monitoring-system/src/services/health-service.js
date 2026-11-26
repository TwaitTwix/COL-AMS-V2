export function getHealthStatus() {
  return {
    status: "ok",
    service: "attendance-monitoring-api",
    timestamp: new Date().toISOString(),
  };
}
