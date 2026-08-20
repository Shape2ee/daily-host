async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `요청 실패 (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function fetchNotionHealth() {
  return request('/api/health');
}

export function fetchNotionMembers() {
  return request('/api/notion/members');
}

export function pushNotionMembers(hosts) {
  return request('/api/notion/members/push', {
    method: 'POST',
    body: JSON.stringify({ hosts }),
  });
}

export function fetchNotionSchedules() {
  return request('/api/notion/schedules');
}

export function upsertNotionSchedules(weeks) {
  return request('/api/notion/schedules/upsert', {
    method: 'POST',
    body: JSON.stringify({ weeks }),
  });
}

export function patchNotionAttendance({ week, day, hostName, present }) {
  return request('/api/notion/schedules/attendance', {
    method: 'POST',
    body: JSON.stringify({ week, day, hostName, present }),
  });
}

export function clearNotionSchedules({ start, end } = {}) {
  return request('/api/notion/schedules/clear', {
    method: 'POST',
    body: JSON.stringify({ start, end }),
  });
}
