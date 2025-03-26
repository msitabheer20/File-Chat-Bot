import ChatInterface from "./components/Chat/ChatInterface";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-900 dark:text-gray-100">
          AI File Analysis Chatbot
        </h1>
        <ChatInterface />
      </div>
    </main>
  );
}