const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const express = require("express");
const PDFDocument = require("pdfkit");

const { attachUser, authorizeRoles, clearAuthCookie, requireAuth, sanitizeUser, setAuthCookie } = require("./auth");
const { PRIORITIES, ROLES, STATUSES } = require("./constants");
const data = require("./data");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function sendError(res, status, message) {
  res.status(status).json({ message });
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return String(value).toLowerCase() === "true";
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function ensureDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function buildMaps(users, departments) {
  return {
    userMap: new Map(users.map((user) => [user.id, user])),
    departmentMap: new Map(departments.map((department) => [department.id, department])),
  };
}

function hydrateUser(user, departmentMap) {
  return {
    ...user,
    department_name: departmentMap.get(user.department_id)?.name || "Unassigned",
  };
}

function hydrateTask(task, userMap, departmentMap) {
  return {
    ...task,
    assignee_name: userMap.get(task.assigned_to)?.full_name || "Unknown user",
    assignee_username: userMap.get(task.assigned_to)?.username || "",
    department_name: departmentMap.get(task.department_id)?.name || "Unassigned",
    creator_name: userMap.get(task.created_by)?.full_name || "System",
    updater_name: userMap.get(task.updated_by)?.full_name || "System",
  };
}

function sortTasks(tasks) {
  const priorityOrder = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  };

  return [...tasks].sort((left, right) => {
    const priorityDelta = (priorityOrder[left.priority] ?? 99) - (priorityOrder[right.priority] ?? 99);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const dueDelta = String(left.due_date).localeCompare(String(right.due_date));
    if (dueDelta !== 0) {
      return dueDelta;
    }

    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
}

function filterTasks(tasks, filters, viewer) {
  const today = new Date().toISOString().slice(0, 10);
  const assignedTo = parseInteger(filters.assignedTo);
  const departmentId = parseInteger(filters.departmentId);
  const search = String(filters.search || "").trim().toLowerCase();

  return tasks.filter((task) => {
    if (viewer.role === "employee" && task.assigned_to !== viewer.id) {
      return false;
    }

    if (filters.status && task.status !== filters.status) {
      return false;
    }

    if (filters.priority && task.priority !== filters.priority) {
      return false;
    }

    if (assignedTo && task.assigned_to !== assignedTo) {
      return false;
    }

    if (departmentId && task.department_id !== departmentId) {
      return false;
    }

    if (search) {
      const haystack = [task.title, task.description, task.assignee_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (filters.due === "overdue" && !(task.due_date < today && task.status !== "Done")) {
      return false;
    }

    if (filters.due === "upcoming" && !(task.due_date >= today && task.due_date <= addDays(today, 7))) {
      return false;
    }

    return true;
  });
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDashboardData(viewer, tasks, users) {
  const today = new Date().toISOString().slice(0, 10);
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "Done").length;
  const inProgress = tasks.filter((task) => task.status === "In Progress").length;
  const overdue = tasks.filter((task) => task.status !== "Done" && task.due_date < today).length;
  const activeEmployees = users.filter((user) => user.role === "employee" && user.is_active).length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;

  return {
    cards: [
      { label: "Total Tasks", value: total, tone: "primary" },
      { label: "In Progress", value: inProgress, tone: "secondary" },
      { label: "Overdue", value: overdue, tone: "danger" },
      {
        label: viewer.role === "employee" ? "Completion Rate" : "Active Employees",
        value: viewer.role === "employee" ? `${completionRate}%` : activeEmployees,
        tone: "success",
      },
    ],
  };
}

function buildReportSummary(tasks) {
  const today = new Date().toISOString().slice(0, 10);

  return {
    total: tasks.length,
    overdue: tasks.filter((task) => task.status !== "Done" && task.due_date < today).length,
    dueToday: tasks.filter((task) => task.due_date === today).length,
    statusCounts: STATUSES.map((status) => ({
      label: status,
      value: tasks.filter((task) => task.status === status).length,
    })),
    priorityCounts: PRIORITIES.map((priority) => ({
      label: priority,
      value: tasks.filter((task) => task.priority === priority).length,
    })),
  };
}

function escapeCsvCell(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function createCsv(tasks) {
  const headers = ["ID", "Title", "Description", "Priority", "Status", "Due Date", "Assigned To", "Department", "Updated At"];
  const rows = tasks.map((task) => [
    task.id,
    task.title,
    task.description,
    task.priority,
    task.status,
    task.due_date,
    task.assignee_name,
    task.department_name || "Unassigned",
    task.updated_at,
  ]);

  return [headers.map(escapeCsvCell).join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\n");
}

function createPdfBuffer(tasks, viewer) {
  const report = buildReportSummary(tasks);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).fillColor("#17324d").text("Task Management Report");
    doc.moveDown(0.4);
    doc
      .fontSize(11)
      .fillColor("#4f657d")
      .text(`Generated for ${viewer.fullName} (${viewer.role}) on ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(12).fillColor("#17324d").text(`Total Tasks: ${report.total}`);
    doc.text(`Overdue Tasks: ${report.overdue}`);
    doc.text(`Due Today: ${report.dueToday}`);
    doc.moveDown();

    tasks.forEach((task, index) => {
      if (doc.y > 720) {
        doc.addPage();
      }

      doc.fontSize(12).fillColor("#17324d").text(`${index + 1}. ${task.title}`);
      doc
        .fontSize(10)
        .fillColor("#4f657d")
        .text(`Assignee: ${task.assignee_name} | Status: ${task.status} | Priority: ${task.priority}`);
      doc.text(`Due: ${task.due_date} | Department: ${task.department_name || "Unassigned"}`);
      doc.text(`Description: ${task.description || "No description"}`);
      doc.moveDown(0.6);
    });

    doc.end();
  });
}

function createWordDocument(tasks, viewer) {
  const rows = tasks.map((task) => `
    <tr>
      <td>${task.id}</td>
      <td>${task.title}</td>
      <td>${task.priority}</td>
      <td>${task.status}</td>
      <td>${task.due_date}</td>
      <td>${task.assignee_name}</td>
      <td>${task.department_name || "Unassigned"}</td>
    </tr>
  `).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Calibri, sans-serif; color: #17324d; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border: 1px solid #cfd8e3; padding: 8px; text-align: left; }
          th { background: #e6eef5; }
        </style>
      </head>
      <body>
        <h1>Task Management Report</h1>
        <p>Generated for ${viewer.fullName} (${viewer.role}) on ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Assigned To</th>
              <th>Department</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function formatUserForClient(user, departmentMap) {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    departmentId: user.department_id,
    departmentName: departmentMap.get(user.department_id)?.name || "Unassigned",
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function formatDepartmentForClient(department, users, tasks) {
  return {
    id: department.id,
    name: department.name,
    description: department.description,
    userCount: users.filter((user) => user.department_id === department.id).length,
    taskCount: tasks.filter((task) => task.department_id === department.id).length,
    createdAt: department.created_at,
    updatedAt: department.updated_at,
  };
}

async function getHydratedTasks(filters, viewer) {
  const [tasks, users, departments] = await Promise.all([
    data.listTasks(),
    data.listUsers(),
    data.listDepartments(),
  ]);

  const { userMap, departmentMap } = buildMaps(users, departments);
  const hydratedTasks = tasks.map((task) => hydrateTask(task, userMap, departmentMap));

  return {
    tasks: sortTasks(filterTasks(hydratedTasks, filters, viewer)),
    users,
    departments,
    userMap,
    departmentMap,
  };
}

async function validateUserPayload(body, { isEdit = false } = {}) {
  const fullName = String(body.fullName || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "").trim().toLowerCase();
  const departmentId = body.departmentId ? parseInteger(body.departmentId) : null;
  const isActive = body.isActive === undefined ? true : normalizeBoolean(body.isActive);

  if (!fullName) {
    return { error: "Full name is required." };
  }

  if (!username) {
    return { error: "Username is required." };
  }

  if (!ROLES.includes(role)) {
    return { error: "Role must be admin, manager, or employee." };
  }

  if (!isEdit && password.trim().length < 6) {
    return { error: "Password must be at least 6 characters long." };
  }

  if (isEdit && password && password.trim().length < 6) {
    return { error: "New password must be at least 6 characters long." };
  }

  if (departmentId) {
    const department = await data.getDepartmentById(departmentId);
    if (!department) {
      return { error: "Selected department does not exist." };
    }
  }

  return {
    data: {
      fullName,
      username,
      password: password.trim(),
      role,
      departmentId,
      isActive,
    },
  };
}

async function validateTaskPayload(body, { isStatusOnly = false } = {}) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const priority = String(body.priority || "").trim();
  const status = String(body.status || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  const assignedTo = parseInteger(body.assignedTo);
  const departmentId = body.departmentId ? parseInteger(body.departmentId) : null;

  if (isStatusOnly) {
    if (!STATUSES.includes(status)) {
      return { error: "Status must be To Do, In Progress, or Done." };
    }

    return { data: { status } };
  }

  if (!title) {
    return { error: "Task title is required." };
  }

  if (!PRIORITIES.includes(priority)) {
    return { error: "Priority must be Low, Medium, High, or Critical." };
  }

  if (!STATUSES.includes(status)) {
    return { error: "Status must be To Do, In Progress, or Done." };
  }

  if (!ensureDateString(dueDate)) {
    return { error: "Due date must use YYYY-MM-DD format." };
  }

  if (!assignedTo) {
    return { error: "An employee must be assigned to the task." };
  }

  const assignee = await data.getUserById(assignedTo);
  if (!assignee || assignee.role !== "employee" || !assignee.is_active) {
    return { error: "Tasks can only be assigned to active employees." };
  }

  if (departmentId) {
    const department = await data.getDepartmentById(departmentId);
    if (!department) {
      return { error: "Selected department does not exist." };
    }
  }

  return {
    data: {
      title,
      description,
      priority,
      status,
      dueDate,
      assignedTo,
      affectedUserId: assignee.id,
      departmentId: departmentId || assignee.department_id || null,
    },
  };
}

function createApiApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);

  app.post("/auth/login", asyncRoute(async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !password) {
      sendError(res, 400, "Username and password are required.");
      return;
    }

    const [userRow, departments] = await Promise.all([
      data.getUserByUsername(username),
      data.listDepartments(),
    ]);

    if (!userRow || !userRow.is_active || !bcrypt.compareSync(password, userRow.password_hash)) {
      sendError(res, 401, "Invalid credentials or access is disabled.");
      return;
    }

    const departmentMap = new Map(departments.map((department) => [department.id, department]));
    const sanitizedUser = sanitizeUser(userRow, departmentMap.get(userRow.department_id)?.name || "Unassigned");
    setAuthCookie(res, sanitizedUser);
    res.json({ user: sanitizedUser });
  }));

  app.post("/auth/logout", requireAuth, (_req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  app.get("/auth/session", requireAuth, asyncRoute(async (req, res) => {
    const department = req.user.departmentId ? await data.getDepartmentById(req.user.departmentId) : null;
    res.json({
      user: {
        ...req.user,
        departmentName: department?.name || "Unassigned",
      },
    });
  }));

  app.get("/dashboard", requireAuth, asyncRoute(async (req, res) => {
    const { tasks, users } = await getHydratedTasks({}, req.user);
    res.json(buildDashboardData(req.user, tasks, users));
  }));

  app.get("/reports/status-summary", requireAuth, asyncRoute(async (req, res) => {
    const { tasks } = await getHydratedTasks(req.query, req.user);
    res.json(buildReportSummary(tasks));
  }));

  app.get("/tasks", requireAuth, asyncRoute(async (req, res) => {
    const { tasks } = await getHydratedTasks(req.query, req.user);
    res.json({ tasks });
  }));

  app.post("/tasks", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const validation = await validateTaskPayload(req.body);
    if (validation.error) {
      sendError(res, 400, validation.error);
      return;
    }

    const timestamp = data.now();
    const task = validation.data;
    const createdTask = await data.createTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      due_date: task.dueDate,
      assigned_to: task.assignedTo,
      department_id: task.departmentId,
      created_by: req.user.id,
      updated_by: req.user.id,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await data.createActivityLog({
      user_id: req.user.id,
      affected_user_id: task.affectedUserId,
      task_id: createdTask.id,
      actor_name: req.user.fullName,
      task_title: task.title,
      action: "Task created",
      details: `${req.user.fullName} created task "${task.title}".`,
      created_at: timestamp,
    });

    res.status(201).json({ success: true });
  }));

  app.put("/tasks/:id", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const taskId = parseInteger(req.params.id);
    const existingTask = taskId ? await data.getTaskById(taskId) : null;

    if (!existingTask) {
      sendError(res, 404, "Task not found.");
      return;
    }

    const validation = await validateTaskPayload(req.body);
    if (validation.error) {
      sendError(res, 400, validation.error);
      return;
    }

    const task = validation.data;
    const timestamp = data.now();

    await data.updateTask(taskId, {
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      due_date: task.dueDate,
      assigned_to: task.assignedTo,
      department_id: task.departmentId,
      updated_by: req.user.id,
      updated_at: timestamp,
    });

    await data.createActivityLog({
      user_id: req.user.id,
      affected_user_id: task.affectedUserId,
      task_id: taskId,
      actor_name: req.user.fullName,
      task_title: task.title,
      action: "Task updated",
      details: `${req.user.fullName} updated task "${task.title}".`,
      created_at: timestamp,
    });

    res.json({ success: true });
  }));

  app.patch("/tasks/:id/status", requireAuth, asyncRoute(async (req, res) => {
    const taskId = parseInteger(req.params.id);
    const existingTask = taskId ? await data.getTaskById(taskId) : null;

    if (!existingTask) {
      sendError(res, 404, "Task not found.");
      return;
    }

    if (req.user.role === "employee" && existingTask.assigned_to !== req.user.id) {
      sendError(res, 403, "Employees can only update their own tasks.");
      return;
    }

    const validation = await validateTaskPayload(req.body, { isStatusOnly: true });
    if (validation.error) {
      sendError(res, 400, validation.error);
      return;
    }

    const timestamp = data.now();
    await data.updateTask(taskId, {
      status: validation.data.status,
      updated_by: req.user.id,
      updated_at: timestamp,
    });

    await data.createActivityLog({
      user_id: req.user.id,
      affected_user_id: existingTask.assigned_to,
      task_id: taskId,
      actor_name: req.user.fullName,
      task_title: existingTask.title,
      action: "Status updated",
      details: `${req.user.fullName} changed "${existingTask.title}" to ${validation.data.status}.`,
      created_at: timestamp,
    });

    res.json({ success: true });
  }));

  app.delete("/tasks/:id", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const taskId = parseInteger(req.params.id);
    const existingTask = taskId ? await data.getTaskById(taskId) : null;

    if (!existingTask) {
      sendError(res, 404, "Task not found.");
      return;
    }

    await data.deleteTask(taskId);
    await data.createActivityLog({
      user_id: req.user.id,
      affected_user_id: existingTask.assigned_to,
      task_id: null,
      actor_name: req.user.fullName,
      task_title: existingTask.title,
      action: "Task deleted",
      details: `${req.user.fullName} deleted task "${existingTask.title}".`,
      created_at: data.now(),
    });

    res.json({ success: true });
  }));

  app.get("/tracking", requireAuth, asyncRoute(async (req, res) => {
    const activity = await data.listActivityLogs(30);
    const filtered = req.user.role === "employee"
      ? activity.filter((entry) => entry.affected_user_id === req.user.id)
      : activity;

    res.json({
      activity: filtered.map((entry) => ({
        id: entry.id,
        action: entry.action,
        details: entry.details,
        created_at: entry.created_at,
        actor_name: entry.actor_name || "System",
        task_title: entry.task_title || "Deleted task",
      })),
    });
  }));

  app.get("/users", requireAuth, authorizeRoles("admin"), asyncRoute(async (_req, res) => {
    const [users, departments] = await Promise.all([data.listUsers(), data.listDepartments()]);
    const departmentMap = new Map(departments.map((department) => [department.id, department]));
    const roleOrder = { admin: 0, manager: 1, employee: 2 };

    const formattedUsers = users
      .map((user) => formatUserForClient(user, departmentMap))
      .sort((left, right) => {
        const roleDelta = (roleOrder[left.role] ?? 99) - (roleOrder[right.role] ?? 99);
        if (roleDelta !== 0) {
          return roleDelta;
        }

        return left.fullName.localeCompare(right.fullName);
      });

    res.json({ users: formattedUsers });
  }));

  app.get("/users/employees", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (_req, res) => {
    const [employees, departments] = await Promise.all([
      data.listUsers({ role: "employee", activeOnly: true }),
      data.listDepartments(),
    ]);

    const departmentMap = new Map(departments.map((department) => [department.id, department]));
    res.json({
      employees: employees.map((employee) => hydrateUser(employee, departmentMap)),
    });
  }));

  app.post("/users", requireAuth, authorizeRoles("admin"), asyncRoute(async (req, res) => {
    const validation = await validateUserPayload(req.body);
    if (validation.error) {
      sendError(res, 400, validation.error);
      return;
    }

    const user = validation.data;
    const duplicate = await data.getUserByUsername(user.username);
    if (duplicate) {
      sendError(res, 409, "Username already exists.");
      return;
    }

    await data.createUser({
      full_name: user.fullName,
      username: user.username,
      password_hash: bcrypt.hashSync(user.password, 10),
      role: user.role,
      department_id: user.departmentId,
      is_active: user.isActive,
      created_at: data.now(),
      updated_at: data.now(),
    });

    res.status(201).json({ success: true });
  }));

  app.put("/users/:id", requireAuth, authorizeRoles("admin"), asyncRoute(async (req, res) => {
    const userId = parseInteger(req.params.id);
    const existingUser = userId ? await data.getUserById(userId) : null;

    if (!existingUser) {
      sendError(res, 404, "User not found.");
      return;
    }

    if (req.user.id === userId && (req.body.role !== "admin" || normalizeBoolean(req.body.isActive) === false)) {
      sendError(res, 400, "You cannot remove your own admin access or disable your current account.");
      return;
    }

    const validation = await validateUserPayload(req.body, { isEdit: true });
    if (validation.error) {
      sendError(res, 400, validation.error);
      return;
    }

    const user = validation.data;
    const duplicate = await data.getUserByUsername(user.username);
    if (duplicate && duplicate.id !== userId) {
      sendError(res, 409, "Username already exists.");
      return;
    }

    const assignedTasks = (await data.listTasks()).filter((task) => task.assigned_to === userId);
    if (existingUser.role === "employee" && user.role !== "employee" && assignedTasks.length) {
      sendError(res, 409, "Reassign this employee's tasks before changing their role.");
      return;
    }

    await data.updateUser(userId, {
      full_name: user.fullName,
      username: user.username,
      role: user.role,
      department_id: user.departmentId,
      is_active: user.isActive,
      updated_at: data.now(),
    });

    if (user.password) {
      await data.updateUser(userId, {
        password_hash: bcrypt.hashSync(user.password, 10),
        updated_at: data.now(),
      });
    }

    res.json({ success: true });
  }));

  app.get("/departments", requireAuth, asyncRoute(async (_req, res) => {
    const [departments, users, tasks] = await Promise.all([
      data.listDepartments(),
      data.listUsers(),
      data.listTasks(),
    ]);

    res.json({
      departments: departments.map((department) => formatDepartmentForClient(department, users, tasks)),
    });
  }));

  app.post("/departments", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    if (!name) {
      sendError(res, 400, "Department name is required.");
      return;
    }

    const duplicate = await data.getDepartmentByName(name);
    if (duplicate) {
      sendError(res, 409, "Department name already exists.");
      return;
    }

    await data.createDepartment({
      name,
      description,
      created_at: data.now(),
      updated_at: data.now(),
    });

    res.status(201).json({ success: true });
  }));

  app.put("/departments/:id", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const departmentId = parseInteger(req.params.id);
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    if (!departmentId) {
      sendError(res, 400, "Invalid department id.");
      return;
    }

    if (!name) {
      sendError(res, 400, "Department name is required.");
      return;
    }

    const duplicate = await data.getDepartmentByName(name);
    if (duplicate && duplicate.id !== departmentId) {
      sendError(res, 409, "Department name already exists.");
      return;
    }

    const updatedDepartment = await data.updateDepartment(departmentId, {
      name,
      description,
      updated_at: data.now(),
    });

    if (!updatedDepartment) {
      sendError(res, 404, "Department not found.");
      return;
    }

    res.json({ success: true });
  }));

  app.delete("/departments/:id", requireAuth, authorizeRoles("admin", "manager"), asyncRoute(async (req, res) => {
    const departmentId = parseInteger(req.params.id);
    if (!departmentId) {
      sendError(res, 400, "Invalid department id.");
      return;
    }

    const [users, tasks] = await Promise.all([data.listUsers(), data.listTasks()]);
    const linkedUsers = users.filter((user) => user.department_id === departmentId).length;
    const linkedTasks = tasks.filter((task) => task.department_id === departmentId).length;

    if (linkedUsers || linkedTasks) {
      sendError(res, 409, "Department cannot be deleted while users or tasks are still assigned to it.");
      return;
    }

    const deletedDepartment = await data.deleteDepartment(departmentId);
    if (!deletedDepartment) {
      sendError(res, 404, "Department not found.");
      return;
    }

    res.json({ success: true });
  }));

  app.get("/exports/tasks.csv", requireAuth, asyncRoute(async (req, res) => {
    const filename = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    const { tasks } = await getHydratedTasks(req.query, req.user);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(createCsv(tasks));
  }));

  app.get("/exports/tasks.pdf", requireAuth, asyncRoute(async (req, res) => {
    const filename = `task-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    const { tasks } = await getHydratedTasks(req.query, req.user);
    const pdfBuffer = await createPdfBuffer(tasks, req.user);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  }));

  app.get("/exports/tasks.doc", requireAuth, asyncRoute(async (req, res) => {
    const filename = `task-report-${new Date().toISOString().slice(0, 10)}.doc`;
    const { tasks } = await getHydratedTasks(req.query, req.user);

    res.setHeader("Content-Type", "application/msword");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(createWordDocument(tasks, req.user));
  }));

  app.use((error, _req, res, _next) => {
    console.error(error);
    sendError(res, 500, error.message || "Unexpected server error.");
  });

  return app;
}

module.exports = {
  createApiApp,
};
