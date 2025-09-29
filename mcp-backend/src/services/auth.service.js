import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { Company } from "../models/company.model.js";
import { Branch } from "../models/branch.model.js";
import {
  hashPassword,
  comparePassword,
  signToken,
} from "../utils/auth.js";

function asObjectIdString(ref) {
  if (!ref) {
    return null;
  }
  if (typeof ref === "string") {
    return ref;
  }
  if (ref instanceof mongoose.Types.ObjectId) {
    return ref.toString();
  }
  if (ref._id) {
    return ref._id.toString();
  }
  return null;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : value;
}

async function resolveCompany(companyInput = {}) {
  const { companyId, companyName, description } = companyInput;
  if (companyId) {
    if (!mongoose.isValidObjectId(companyId)) {
      throw new Error("companyId is not a valid identifier");
    }
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }
    return company;
  }

  const name = normalizeString(companyName);
  if (!name) {
    return null;
  }

  const existing = await Company.findOne({ name });
  if (existing) {
    return existing;
  }

  const company = new Company({ name, description });
  return company.save();
}

async function resolveBranch(company, branchInput = {}) {
  if (!branchInput) {
    return null;
  }
  const { branchId, branchName, address } = branchInput;
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) {
      throw new Error("branchId is not a valid identifier");
    }
    const branch = await Branch.findById(branchId);
    if (!branch) {
      throw new Error("Branch not found");
    }
    if (company && branch.company.toString() !== company._id.toString()) {
      throw new Error("Branch does not belong to the selected company");
    }
    return branch;
  }

  const name = normalizeString(branchName);
  if (!name) {
    return null;
  }
  if (!company) {
    throw new Error("Company must be provided to attach a branch");
  }
  const existing = await Branch.findOne({
    company: company._id,
    name,
  });
  if (existing) {
    return existing;
  }
  const branch = new Branch({ name, company: company._id, address });
  return branch.save();
}

function mapUserToTokenPayload(user) {
  return {
    sub: asObjectIdString(user._id),
    role: user.role,
    companyId: asObjectIdString(user.company),
    branchId: asObjectIdString(user.branch),
  };
}

export async function registerAdmin(input, actingUser = null) {
  const adminExists = await User.exists({ role: "admin" });
  if (adminExists && (!actingUser || actingUser.role !== "admin")) {
    throw new Error(
      "Admin already configured. Provide an admin token to create another admin."
    );
  }

  const { name, email, password, company: companyInput, branch: branchInput } =
    input;
  if (!name || !email || !password) {
    throw new Error("name, email, and password are required");
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new Error("A user with this email already exists");
  }

  const company = await resolveCompany(companyInput);
  const branch = await resolveBranch(company, branchInput);

  const passwordHash = await hashPassword(password);
  const user = new User({
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: "admin",
    company: company?._id,
    branch: branch?._id,
  });
  await user.save();
  await user.populate(["company", "branch"]);
  const token = signToken(mapUserToTokenPayload(user));
  return {
    token,
    user: user.toJSON(),
  };
}

export async function login({ email, password }) {
  if (!email || !password) {
    throw new Error("email and password are required");
  }
  const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    .populate("company")
    .populate("branch");
  if (!user) {
    throw new Error("Invalid credentials");
  }
  const isMatch = await comparePassword(password, user.passwordHash);
  if (!isMatch) {
    throw new Error("Invalid credentials");
  }
  const token = signToken(mapUserToTokenPayload(user));
  return { token, user: user.toJSON() };
}

export async function createCompany({ name, description }) {
  if (!name) {
    throw new Error("Company name is required");
  }
  const normalized = name.trim();
  const exists = await Company.findOne({ name: normalized });
  if (exists) {
    throw new Error("Company with this name already exists");
  }
  const company = new Company({ name: normalized, description });
  return company.save();
}

export async function listCompanies() {
  return Company.find({ isActive: true }).sort({ name: 1 }).lean();
}

export async function createBranch({ companyId, name, address }) {
  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw new Error("companyId is required and must be valid");
  }
  if (!name) {
    throw new Error("Branch name is required");
  }
  const company = await Company.findById(companyId);
  if (!company) {
    throw new Error("Company not found");
  }
  const normalized = name.trim();
  const exists = await Branch.findOne({ company: companyId, name: normalized });
  if (exists) {
    throw new Error("Branch with this name already exists for the company");
  }
  const branch = new Branch({
    name: normalized,
    company: companyId,
    address,
  });
  return branch.save();
}

export async function listBranches(companyId = null) {
  const filter = { isActive: true };
  if (companyId) {
    if (!mongoose.isValidObjectId(companyId)) {
      throw new Error("companyId must be a valid identifier");
    }
    filter.company = companyId;
  }
  return Branch.find(filter)
    .sort({ name: 1 })
    .populate("company")
    .lean();
}

export async function createUser(input) {
  const { name, email, password, company, branch } = input;
  if (!name || !email || !password) {
    throw new Error("name, email, and password are required");
  }
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new Error("A user with this email already exists");
  }

  const companyDoc = await resolveCompany(company);
  const branchDoc = await resolveBranch(companyDoc, branch);

  const passwordHash = await hashPassword(password);
  const user = new User({
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: "user",
    company: companyDoc?._id,
    branch: branchDoc?._id,
  });
  await user.save();
  await user.populate(["company", "branch"]);
  return user.toJSON();
}

export async function listUsers() {
  return User.find({ isActive: true })
    .select("-passwordHash")
    .populate("company")
    .populate("branch")
    .sort({ createdAt: -1 })
    .lean();
}
