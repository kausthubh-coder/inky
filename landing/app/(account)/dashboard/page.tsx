"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../../../convex/_generated/api";
import { track } from "../../../lib/analytics";
import { DashboardLoading, DashboardOverview } from "../../../components/dashboard-overview";

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const syncProfile = useMutation(api.account.syncWebProfile);
  const overview = useQuery(api.account.portalOverview, isAuthenticated ? {} : "skip");
  const synced = useRef(false);
  const viewed = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || synced.current) return;
    synced.current = true;
    void syncProfile({}).catch(() => undefined);
  }, [isAuthenticated, syncProfile]);

  useEffect(() => {
    if (!isAuthenticated || viewed.current) return;
    viewed.current = true;
    track("dashboard_viewed");
  }, [isAuthenticated]);

  if (isLoading || overview === undefined) return <DashboardLoading />;
  return <DashboardOverview overview={overview} />;
}
