import withNextIntl from "next-intl/plugin";
import type { NextConfig } from "next";

const withIntl = withNextIntl();

const nextConfig: NextConfig = {};

export default withIntl(nextConfig);
