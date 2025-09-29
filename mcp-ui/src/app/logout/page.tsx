"use client";

import { useEffect } from "react";
import { logout } from "../../../src/services/api";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();
  useEffect(() => {
    logout();
    router.replace("/login");
  }, [router]);
  return null;
}
