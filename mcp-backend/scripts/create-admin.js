#!/usr/bin/env node
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../src/db/mongoose.js";
import { User } from "../src/models/user.model.js";
import { Company } from "../src/models/company.model.js";
import { Branch } from "../src/models/branch.model.js";
import { hashPassword } from "../src/utils/auth.js";

function readEnv(name, fallback = null) {
  const value = process.env[name.toUpperCase()];
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}

async function ensureCompany(companyName) {
  if (!companyName) return null;
  const existing = await Company.findOne({ name: companyName.trim() });
  if (existing) return existing;
  const doc = new Company({ name: companyName.trim() });
  return doc.save();
}

async function ensureBranch(company, branchName) {
  if (!branchName) return null;
  if (!company) throw new Error("Company required to attach a branch");
  const existing = await Branch.findOne({
    company: company._id,
    name: branchName.trim(),
  });
  if (existing) return existing;
  const doc = new Branch({
    name: branchName.trim(),
    company: company._id,
  });
  return doc.save();
}

async function main() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("MongoDB bağlantısı kurulamadı. MONGO_URI ayarlı mı?");
  }

  const name = readEnv("ADMIN_NAME", "Sistem Yöneticisi");
  const email = String(
    readEnv("ADMIN_EMAIL", "admin@example.com")
  ).toLowerCase();
  const password = readEnv("ADMIN_PASSWORD", "Admin123!");
  // Provide sensible defaults so we always create org context if not supplied
  const companyName = readEnv("COMPANY_NAME", "DefaultCo");
  const branchName = readEnv("BRANCH_NAME", "HQ");

  const existingAdmin = await User.findOne({ email });
  if (existingAdmin) {
    // Attach company/branch if missing
    const company = await ensureCompany(companyName);
    const branch = await ensureBranch(company, branchName);

    let didUpdate = false;
    if (!existingAdmin.company && company?._id) {
      existingAdmin.company = company._id;
      didUpdate = true;
    }
    if (!existingAdmin.branch && branch?._id) {
      existingAdmin.branch = branch._id;
      didUpdate = true;
    }
    if (didUpdate) {
      await existingAdmin.save();
    }
    await existingAdmin.populate(["company", "branch"]);
    console.log("Kullanıcı zaten mevcut, bağlam güncellendi:", {
      id: existingAdmin._id.toString(),
      email: existingAdmin.email,
      role: existingAdmin.role,
      company: existingAdmin.company ? existingAdmin.company.name : null,
      branch: existingAdmin.branch ? existingAdmin.branch.name : null,
      updated: didUpdate,
    });
    return;
  }

  const company = await ensureCompany(companyName);
  const branch = await ensureBranch(company, branchName);

  const passwordHash = await hashPassword(password);
  const user = new User({
    name,
    email,
    passwordHash,
    role: "admin",
    company: company?._id,
    branch: branch?._id,
  });
  await user.save();
  await user.populate(["company", "branch"]);

  console.log("Admin oluşturuldu:", {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    company: user.company ? user.company.name : null,
    branch: user.branch ? user.branch.name : null,
  });
}

main()
  .catch((err) => {
    console.error("Hata:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
