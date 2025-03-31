"use client"
import Link from 'next/link';
import { MessageSquare, Users, FileText } from 'lucide-react';

interface DashboardCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  color: string;
}

function DashboardCard({ title, description, icon, href, color }: DashboardCardProps) {
  return (
    <Link href={href} className={`block p-6 rounded-lg shadow-md transition-transform hover:scale-105 ${color}`}>
      <div className="flex items-center">
        <div className="mr-4 text-white">{icon}</div>
        <div>
          <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
          <p className="text-white/80">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DashboardCard
          title="Slack Lunch Status"
          description="Monitor and manage lunch status tags in Slack channels"
          icon={<Users className="h-8 w-8" />}
          href="/admin/slack"
          color="bg-indigo-600"
        />
        
        <DashboardCard
          title="Chatbot"
          description="View chat logs and configure the AI assistant"
          icon={<MessageSquare className="h-8 w-8" />}
          href="/"
          color="bg-purple-600"
        />
        
        <DashboardCard
          title="Document Analytics"
          description="View metrics about uploaded documents and queries"
          icon={<FileText className="h-8 w-8" />}
          href="/admin"
          color="bg-blue-600"
        />
      </div>
      
      <div className="mt-12 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">System Status</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">API Status</h3>
            <div className="mt-1 flex items-center">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
              <span className="text-gray-900 dark:text-gray-100 font-medium">Operational</span>
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Slack Integration</h3>
            <div className="mt-1 flex items-center">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
              <span className="text-gray-900 dark:text-gray-100 font-medium">Connected</span>
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Vector Database</h3>
            <div className="mt-1 flex items-center">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
              <span className="text-gray-900 dark:text-gray-100 font-medium">Online</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 