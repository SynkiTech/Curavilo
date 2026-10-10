import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check if user is signed in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }

      // Fetch organizations (placeholder)
      // In a real app, we would query the database for organizations
      // associated with the user
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Organizations
        </h1>
        <div className="mb-6">
          <a
            href="/organizations/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            New Organization
          </a>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Your Organizations
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              You haven't created any organizations yet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}