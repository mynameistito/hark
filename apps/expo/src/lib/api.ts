import type {
  DeviceDto,
  DeviceRegisterInput,
  DeviceUnregisterInput,
  EventDto,
  InboxActivityKind,
  InboxActivityPageDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxMarkAllReadInput,
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxProjectsDto,
  InteractionCredentialResponseInput,
  InteractionDto,
  InteractionResponseInput,
  LiveActivityPushToStartTokenInput,
  LiveActivityUpdateTokenInput,
} from "@hark/contracts";
import { ApiError, apiErrorFromBody } from "./api-error";
import { API_URL, getCookie } from "./auth";

export type { NotificationDetailFailure } from "./api-error";
export { ApiError, classifyNotificationDetailFailure } from "./api-error";

type CrossPlatformDeviceRegisterInput = Omit<DeviceRegisterInput, "platform"> & {
  platform: "ios" | "android";
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = getCookie();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || body === null) {
    throw apiErrorFromBody(response.status, body);
  }
  return body;
}

async function registerDevice(input: CrossPlatformDeviceRegisterInput) {
  const send = (payload: CrossPlatformDeviceRegisterInput) =>
    request<{ device: { id: string } }>("/api/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    });

  try {
    return await send(input);
  } catch (error) {
    // Android builds can be tested against an older Hark server before the
    // Android-aware backend in this PR is deployed. Expo push tokens are
    // transport-neutral, so legacy servers can still deliver through FCM even
    // though they temporarily record the device as iOS. Once the new server is
    // live, the first registration succeeds with platform=android and this path
    // is never used.
    if (
      input.platform !== "android" ||
      !(error instanceof ApiError) ||
      error.status !== 400 ||
      !error.message.includes("Invalid device registration")
    ) {
      throw error;
    }
    return send({ ...input, platform: "ios" });
  }
}

export const api = {
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  registerDevice,
  unregisterDevice: (input: DeviceUnregisterInput) =>
    request<{ ok: true }>("/api/devices", {
      method: "DELETE",
      body: JSON.stringify(input),
    }),
  registerLiveActivityPushToStartToken: (input: LiveActivityPushToStartTokenInput) =>
    request<{ deviceId: string; updatedAt?: string }>("/api/devices/live-activity/push-to-start", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  registerLiveActivityUpdateToken: (input: LiveActivityUpdateTokenInput) =>
    request<{ activityId: string; deviceId: string }>("/api/devices/live-activity/update-token", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listEvents: (limit = 20) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listPendingInteractions: () =>
    request<{ interactions: InboxInteractionDto[] }>("/api/interactions"),
  listActiveActivities: () => request<{ activities: InboxLiveActivityDto[] }>("/api/activities"),
  listActivityFeed: (filter: "all" | InboxActivityKind, page: number) =>
    request<InboxActivityPageDto>(`/api/activity-feed?filter=${filter}&page=${page}`),
  respondToInteraction: (id: string, input: InteractionResponseInput) =>
    request<{ interaction: InteractionDto }>(`/api/interactions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  respondToInteractionWithToken: (id: string, input: InteractionCredentialResponseInput) =>
    request<{ ok: true; status: string }>(`/api/interaction-responses/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Project inbox endpoints. Older or self-hosted servers 404 on these; the
  // app treats that as "no project inbox" and keeps the legacy behavior.
  listInboxProjects: () => request<InboxProjectsDto>("/api/inbox/projects"),
  listInboxNotifications: (params: {
    project?: string;
    unread?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.project) query.set("project", params.project);
    if (params.unread) query.set("unread", "1");
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("limit", String(params.limit ?? 20));
    return request<InboxNotificationPageDto>(`/api/inbox/notifications?${query.toString()}`);
  },
  getInboxNotification: (id: string) =>
    request<{ notification: InboxNotificationDetailDto }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}`,
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: true; readAt: string }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markNotificationUnread: (id: string) =>
    request<{ ok: true; readAt: null }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/unread`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markAllNotificationsRead: (input: InboxMarkAllReadInput) =>
    request<{ ok: true; updated: number }>("/api/inbox/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
