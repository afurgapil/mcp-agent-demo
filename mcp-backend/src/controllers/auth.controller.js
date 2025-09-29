import {
  registerAdmin,
  login,
  createCompany,
  listCompanies,
  createBranch,
  listBranches,
  createUser,
  listUsers,
} from "../services/auth.service.js";

function handleError(res, err, defaultStatus = 400) {
  const status = err?.status || defaultStatus;
  const message = err?.message || "Unexpected error";
  if (status >= 500) {
    console.error(err);
  }
  return res.status(status).json({ error: message });
}

export async function registerAdminHandler(req, res) {
  try {
    const { token, user } = await registerAdmin(
      req.body,
      req.userDocument || req.user || null
    );
    return res.status(201).json({ token, user });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function loginHandler(req, res) {
  try {
    const { token, user } = await login(req.body);
    return res.status(200).json({ token, user });
  } catch (err) {
    return handleError(res, err, 401);
  }
}

export async function createCompanyHandler(req, res) {
  try {
    const company = await createCompany(req.body);
    return res.status(201).json({ company });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function listCompaniesHandler(req, res) {
  try {
    const companies = await listCompanies();
    return res.status(200).json({ companies });
  } catch (err) {
    return handleError(res, err, 500);
  }
}

export async function createBranchHandler(req, res) {
  try {
    const branch = await createBranch(req.body);
    return res.status(201).json({ branch });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function listBranchesHandler(req, res) {
  try {
    const { companyId } = req.query;
    const branches = await listBranches(companyId || null);
    return res.status(200).json({ branches });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function createUserHandler(req, res) {
  try {
    const user = await createUser(req.body);
    return res.status(201).json({ user });
  } catch (err) {
    return handleError(res, err);
  }
}

export async function listUsersHandler(req, res) {
  try {
    const users = await listUsers();
    return res.status(200).json({ users });
  } catch (err) {
    return handleError(res, err, 500);
  }
}

export async function meHandler(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.status(200).json({ user: req.user });
}
