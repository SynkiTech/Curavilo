"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function NewOrganizationPage() {
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // In a real app, we would upload logo to Supabase Storage and get URL
    // For now, we'll just store the URL as provided

    // Create organization in database (placeholder)
    // We'll simulate by inserting into a table (not implemented)
    // For demonstration, we'll just redirect
    try {
      // Placeholder: actually insert into organizations table
      // const { data, error: dbError } = await supabase
      //   .from('organizations')
      //   .insert({ name, logo_url: logoUrl || null });
      // if (dbError) throw dbError;

      // For now, fake success
      await new Promise(res => setTimeout(res, 1000));
      router.push("/organizations");
    } catch (err: any) {
      setError(err.message || "Failed to create organization");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            New Organization
          </h1>
          <a
            href="/organizations"
            className="text-sm font-medium text-indigo-600 dark:text-gray-300 hover:text-indigo-500 dark:hover:text-gray-200"
          >
            Back to Organizations
          </a>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <form className="px-6 py-8" onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Organization Name
                </label>
                <input
                  type="text"
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-0 px-3.5 py-2.5 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  placeholder="Enter organization name"
                />
              </div>

              <div>
                <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Logo URL (optional)
                </label>
                <input
                  type="text"
                  id="logoUrl"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="mt-1 block w-full rounded-md border-0 px-3.5 py-2.5 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                  placeholder="https://example.com/logo.png"
                />
              </div>

              <div>
                <label htmlFor="services" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Services (comma-separated)
                </label>
                <input
                  type="text"
                  id="services"
                  placeholder="e.g., Hospital, Clinic, Pharmacy"
                  className="mt-1 block w-full rounded-md border-0 px-3.5 py-2.5 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>

              {error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:ring-offset-2 focus:ring-offset-indigo-500"
                >
                  {loading ? "Creating..." : "Create Organization"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}