"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">Loading...</div>;
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Welcome back, {session.user?.email?.split("@")[0] ?? "User"}!
        </h1>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Organizations
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Manage your healthcare organizations and facilities
            </p>
            <a
              href="/organizations"
              className="mt-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              Manage Organizations
            </a>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Facilities
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              View and manage facilities across organizations
            </p>
            <a
              href="/facilities"
              className="mt-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              Manage Facilities
            </a>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Staff
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Manage staff members and their roles
            </p>
            <a
              href="/staff"
              className="mt-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              Manage Staff
            </a>
          </div>
        </div>
        <div className="mt-8 flex items-center justify-between">
          <a
            href="/profile"
            className="text-sm font-medium text-indigo-600 dark:text-gray-300 hover:text-indigo-500 dark:hover:text-gray-200"
          >
            Profile
          </a>
          <button
            onClick async () => {
              await supabase.auth.signOut();
              router.push("/login");
            }
            className="text-sm font-medium text-red-600 dark:text-gray-400 hover:text-red-500 dark:hover:text-gray-300"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}