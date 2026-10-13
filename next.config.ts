import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs y unpdf se cargan como dependencias de Node, sin bundlear
  serverExternalPackages: ["exceljs", "unpdf"],
};

export default nextConfig;
