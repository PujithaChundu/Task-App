const { supabase } = require("./supabase");

const now = () => new Date().toISOString();

function unwrap({ data, error }, fallbackMessage) {
  if (error) {
    throw new Error(error.message || fallbackMessage || "Database request failed.");
  }

  return data;
}

async function getUserById(id) {
  return unwrap(
    await supabase.from("app_users").select("*").eq("id", id).maybeSingle(),
    "Failed to load user."
  );
}

async function getUserByUsername(username) {
  return unwrap(
    await supabase.from("app_users").select("*").eq("username", username).maybeSingle(),
    "Failed to load user by username."
  );
}

async function listUsers({ role = null, activeOnly = false } = {}) {
  let query = supabase.from("app_users").select("*");

  if (role) {
    query = query.eq("role", role);
  }

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  return unwrap(
    await query.order("full_name", { ascending: true }),
    "Failed to load users."
  );
}

async function createUser(payload) {
  return unwrap(
    await supabase.from("app_users").insert([payload]).select("*").single(),
    "Failed to create user."
  );
}

async function updateUser(id, payload) {
  return unwrap(
    await supabase.from("app_users").update(payload).eq("id", id).select("*").maybeSingle(),
    "Failed to update user."
  );
}

async function listDepartments() {
  return unwrap(
    await supabase.from("app_departments").select("*").order("name", { ascending: true }),
    "Failed to load departments."
  );
}

async function getDepartmentById(id) {
  return unwrap(
    await supabase.from("app_departments").select("*").eq("id", id).maybeSingle(),
    "Failed to load department."
  );
}

async function getDepartmentByName(name) {
  return unwrap(
    await supabase.from("app_departments").select("*").eq("name", name).maybeSingle(),
    "Failed to load department by name."
  );
}

async function createDepartment(payload) {
  return unwrap(
    await supabase.from("app_departments").insert([payload]).select("*").single(),
    "Failed to create department."
  );
}

async function updateDepartment(id, payload) {
  return unwrap(
    await supabase.from("app_departments").update(payload).eq("id", id).select("*").maybeSingle(),
    "Failed to update department."
  );
}

async function deleteDepartment(id) {
  return unwrap(
    await supabase.from("app_departments").delete().eq("id", id).select("id").maybeSingle(),
    "Failed to delete department."
  );
}

async function listTasks() {
  return unwrap(
    await supabase.from("app_tasks").select("*").order("updated_at", { ascending: false }),
    "Failed to load tasks."
  );
}

async function getTaskById(id) {
  return unwrap(
    await supabase.from("app_tasks").select("*").eq("id", id).maybeSingle(),
    "Failed to load task."
  );
}

async function createTask(payload) {
  return unwrap(
    await supabase.from("app_tasks").insert([payload]).select("*").single(),
    "Failed to create task."
  );
}

async function updateTask(id, payload) {
  return unwrap(
    await supabase.from("app_tasks").update(payload).eq("id", id).select("*").maybeSingle(),
    "Failed to update task."
  );
}

async function deleteTask(id) {
  return unwrap(
    await supabase.from("app_tasks").delete().eq("id", id).select("id").maybeSingle(),
    "Failed to delete task."
  );
}

async function listActivityLogs(limit = 30) {
  return unwrap(
    await supabase
      .from("app_activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit),
    "Failed to load activity logs."
  );
}

async function createActivityLog(payload) {
  return unwrap(
    await supabase.from("app_activity_logs").insert([payload]).select("*").single(),
    "Failed to write activity log."
  );
}

module.exports = {
  createActivityLog,
  createDepartment,
  createTask,
  createUser,
  deleteDepartment,
  deleteTask,
  getDepartmentById,
  getDepartmentByName,
  getTaskById,
  getUserById,
  getUserByUsername,
  listActivityLogs,
  listDepartments,
  listTasks,
  listUsers,
  now,
  updateDepartment,
  updateTask,
  updateUser,
};
