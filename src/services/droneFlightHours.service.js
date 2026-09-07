export const addMissionFlightHours = async (tx, { organisationId, missionId, droneIds = [] }) => {
  const uniqueDroneIds = [...new Set(droneIds.filter(Boolean))];
  if (!uniqueDroneIds.length) return [];

  const telemetryWindows = await tx.telemetryLog.groupBy({
    by: ["droneId"],
    where: {
      organisationId,
      missionId,
      droneId: { in: uniqueDroneIds }
    },
    _min: { timestamp: true },
    _max: { timestamp: true }
  });

  const summaries = telemetryWindows
    .map((window) => {
      const startedAt = window._min.timestamp;
      const endedAt = window._max.timestamp;
      const durationMs = startedAt && endedAt
        ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
        : 0;

      return {
        droneId: window.droneId,
        startedAt,
        endedAt,
        durationHours: Number(Math.max(0, durationMs / 3_600_000).toFixed(4))
      };
    })
    .filter((summary) => summary.durationHours > 0);

  await Promise.all(
    summaries.map((summary) => tx.drone.update({
      where: { id: summary.droneId },
      data: { flightHours: { increment: summary.durationHours } }
    }))
  );

  return summaries;
};
