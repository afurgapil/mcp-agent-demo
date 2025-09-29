#!/usr/bin/env node
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../src/db/mongoose.js";
import { User } from "../src/models/user.model.js";
import { Company } from "../src/models/company.model.js";
import { Branch } from "../src/models/branch.model.js";
import { hashPassword } from "../src/utils/auth.js";

function getArg(name, fallback = null) {
  const flag = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(flag));
  if (match) return match.slice(flag.length);
  return process.env[name.toUpperCase()] || fallback;
}

async function ensureCompany(companyName, description) {
  if (!companyName) return null;
  const existing = await Company.findOne({ name: companyName.trim() });
  if (existing) return existing;
  const doc = new Company({ name: companyName.trim(), description });
  return doc.save();
}

async function ensureBranch(company, branchName, address) {
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
    address,
  });
  return doc.save();
}

async function main() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("MongoDB bağlantısı kurulamadı. MONGO_URI ayarlı mı?");
  }

  const name = getArg("name", "Sistem Yöneticisi");
  const email = getArg("email", "admin@example.com").toLowerCase();
  const password = getArg("password", "Admin123!");
  const companyName = getArg("company");
  const companyDesc = getArg("company_desc");
  const branchName = getArg("branch");
  const branchAddr = getArg("branch_addr");

  const existingAdmin = await User.findOne({ email });
  if (existingAdmin) {
    console.log("Kullanıcı zaten mevcut:", existingAdmin.email);
    return;
  }

  const company = await ensureCompany(companyName, companyDesc);
  const branch = await ensureBranch(company, branchName, branchAddr);

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
