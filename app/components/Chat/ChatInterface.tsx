"use client"
import { useState, useRef, useEffect } from 'react';
import { Message, FileData } from '@/types/chat';
import { Trash2, FileIcon, Plus, Sun, Moon, Users, Settings } from 'lucide-react';
import FileUploadModal from './FileUploadModal';
import { useTheme } from '@/contexts/ThemeContext';
import Link from 'next/link';

declare global {
	interface Window {
		pdfjsLib: any;
	}
}

// For the Slack lunch status visualization
interface SlackUser {
	name: string;
	id: string;
	status: string;
	lunchStartTime?: string;
	lunchEndTime?: string;
}

interface SlackLunchReport {
	channel: string;
	timeframe: string;
	users: SlackUser[];
	total: number;
	timestamp: string;
}

// For Slack update status visualization
interface UpdateUser {
	id: string;
	name: string;
	hasPosted: boolean;
	timestamp?: string;
	content?: string;
	allUpdates?: Array<{ timestamp: string; content: string }>;
}

interface SlackUpdateReport {
	channel: string;
	timeframe: string;
	users: UpdateUser[];
	timestamp: string;
}

// For Slack report status visualization
interface ReportUser {
	id: string;
	name: string;
	hasPosted: boolean;
	timestamp?: string;
	content?: string;
	allReports?: Array<{ timestamp: string; content: string }>;
}

interface SlackReportStatusReport {
	channel: string;
	timeframe: string;
	users: ReportUser[];
	timestamp: string;
}

export default function ChatInterface() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState('');
	const [files, setFiles] = useState<FileData[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingStatus, setProcessingStatus] = useState<string>('');
	const chatContainerRef = useRef<HTMLDivElement>(null);
	const [isPdfLibLoaded, setIsPdfLibLoaded] = useState(false);
	const [isPdfLibLoading, setIsPdfLibLoading] = useState(true);
	const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
	const [selectedContent, setSelectedContent] = useState<{ content: string, name: string } | null>(null);
	const { theme, setTheme, toggleTheme } = useTheme();

	const processPdfFile = async (file: File): Promise<string> => {
		if (!window.pdfjsLib) {
			throw new Error('PDF.js library not loaded');
		}

		try {
			console.log('\n=== PDF Processing Details ===');
			console.log('File name:', file.name);
			console.log('File size:', file.size);

			const arrayBuffer = await file.arrayBuffer();
			console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);

			const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
			console.log('PDF loaded, total pages:', pdf.numPages);

			let fullText = '';
			let hasText = false;
			let totalTextLength = 0;
			let pagesWithText = 0;

			for (let i = 1; i <= pdf.numPages; i++) {
				console.log(`\nProcessing page ${i}/${pdf.numPages}`);
				const page = await pdf.getPage(i);
				const textContent = await page.getTextContent();
				const pageText = textContent.items
					.map((item: any) => item.str)
					.join(' ');

				console.log(`Page ${i} text length:`, pageText.length);
				console.log(`Page ${i} text preview:`, pageText.substring(0, 100) + '...');

				if (pageText.trim().length > 0) {
					hasText = true;
					fullText += pageText + '\n';
					totalTextLength += pageText.length;
					pagesWithText++;
					console.log(`Page ${i} contains text (${pageText.length} characters)`);
				} else {
					console.log(`Page ${i} contains no extractable text`);
				}
			}

			console.log('\n=== PDF Processing Summary ===');
			console.log('Total pages processed:', pdf.numPages);
			console.log('Pages with text:', pagesWithText);
			console.log('Total text length:', totalTextLength);
			console.log('Average text per page:', Math.round(totalTextLength / pagesWithText));
			console.log('Full text preview:', fullText.substring(0, 200) + '...');

			if (!hasText) {
				throw new Error('This PDF appears to be image-based or contains no extractable text. Please ensure the PDF contains actual text content.');
			}

			return fullText;
		} catch (error) {
			console.error('Error processing PDF:', error);
			throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	const handleFileUpload = async (files: FileList | null) => {
		if (!files?.length) return;

		setIsProcessing(true);
		setProcessingStatus('Processing files...');

		// Add single upload message
		setMessages(prev => [
			...prev,
			{
				id: Date.now().toString(),
				role: 'system',
				content: 'Uploading file...',
				timestamp: Date.now(),
			},
		]);

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (file.size > 5 * 1024 * 1024) {
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'system',
							content: `File ${file.name} is too large. Maximum size is 5MB.`,
							timestamp: Date.now(),
						},
					]);
					continue;
				}

				const fileData: FileData = {
					id: Math.random().toString(36).substring(7),
					name: file.name,
					type: file.type,
					size: file.size,
				};

				setFiles(prev => [...prev, fileData]);

				if (file.type === 'application/pdf') {
					// Wait for PDF.js to be loaded
					let attempts = 0;
					const maxAttempts = 10;
					while (!isPdfLibLoaded && attempts < maxAttempts) {
						await new Promise(resolve => setTimeout(resolve, 500));
						attempts++;
						// console.log(`Waiting for PDF.js to load... Attempt ${attempts}/${maxAttempts}`);
					}

					if (!isPdfLibLoaded) {
						throw new Error('PDF.js library failed to load. Please refresh the page and try again.');
					}

					console.log('PDF.js library loaded, processing file...');
					const content = await processPdfFile(file);
					if (!content.trim()) {
						throw new Error('No text content could be extracted from the PDF. The file might be image-based or have security restrictions.');
					}

					// Process document through Pinecone
					const response = await fetch('/api/process-document', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							fileId: fileData.id,
							content,
							metadata: {
								pages: (await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise).numPages,
							},
						}),
					});

					if (!response.ok) {
						throw new Error('Failed to process document in vector database');
					}

					const result = await response.json();
					console.log('Document processing result:', result);
				} else {
					// Handle text files
					const text = await file.text();

					// Process document through Pinecone
					const response = await fetch('/api/process-document', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							fileId: fileData.id,
							content: text,
							metadata: {
								filename: file.name,
								type: file.type,
								size: file.size,
							},
						}),
					});

					if (!response.ok) {
						throw new Error('Failed to process document in vector database');
					}

					const result = await response.json();
					console.log('Document processing result:', result);
				}
			}

			// Add completion message
			setMessages(prev => [
				...prev,
				{
					id: Date.now().toString(),
					role: 'system',
					content: 'File uploaded successfully. You can now ask questions about its content.',
					timestamp: Date.now(),
				},
			]);
		} catch (error) {
			console.error('Error processing files:', error);
			setMessages(prev => [
				...prev,
				{
					id: Date.now().toString(),
					role: 'system',
					content: `Error uploading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
					timestamp: Date.now(),
				},
			]);
		} finally {
			setIsProcessing(false);
			setProcessingStatus('');
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isLoading) return;

		const userMessage = input.trim();
		setInput('');
		setMessages(prev => [
			...prev,
			{
				id: Date.now().toString(),
				role: 'user',
				content: userMessage,
				timestamp: Date.now(),
			},
		]);
		setIsLoading(true);

		try {
			// console.log('Starting chat request...');
			// console.log('Files state:', files);
			// console.log('User message:', userMessage);

			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					message: userMessage,
					files: files.map(f => ({
						id: f.id,
						name: f.name,
					})),
				}),
			});

			// console.log('Response status:', response.status);
			// console.log('Response headers:', Object.fromEntries(response.headers.entries()));

			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				console.error('Error response data:', errorData);
				throw new Error(errorData?.error || `HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			// console.log('Success response data:', data);

			// Check if the response includes a function call
			if (data.functionCall) {
				if (data.functionCall.name === 'setTheme') {
					// Handle theme change function
					const { theme: newTheme } = data.functionCall.arguments;
					setTheme(newTheme);

					// Add message about the theme change
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'assistant',
							content: data.content,
							timestamp: Date.now(),
						},
						{
							id: (Date.now() + 1).toString(),
							role: 'system',
							content: `Theme changed to ${newTheme} mode.`,
							timestamp: Date.now() + 1,
						},
					]);
				}
				else if (data.functionCall.name === 'getSlackLunchStatus') {
					// Handle Slack lunch status function
					const result = data.functionCall.result as SlackLunchReport;

					// Add assistant message with the lunch status table
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'assistant',
							content: '',
							timestamp: Date.now(),
							customContent: (
								<div className="w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
									{/* Header */}
									<div className="bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
										<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
											Lunch Status for #{result.channel} ({result.timeframe})
										</h3>
										<div className="mt-2 flex flex-wrap gap-2">
											<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
												Total users: {result.users.filter(user => user.name !== "checkbot").length}
											</span>
											<span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${result.total > 0
													? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
													: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
												}`}>
												Missing tags: {result.users.filter(user => user.name !== "checkbot" && user.status !== "complete").length}
											</span>
										</div>
									</div>

									{/* Table */}
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
											<thead className="bg-gray-50 dark:bg-gray-900">
												<tr>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
													<th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ID</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
													<th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lunch Start</th>
													<th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lunch End</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
												</tr>
											</thead>
											<tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
												{/* Sort users - incomplete first, then complete */}
												{[...result.users]
													// Filter out users with name "checkbot"
													.filter(user => user.name !== "checkbot")
													.sort((a, b) => {
														if (a.status !== "complete" && b.status === "complete") return -1;
														if (a.status === "complete" && b.status !== "complete") return 1;
														return a.name.localeCompare(b.name);
													}).map((user, index) => {
														// Calculate time gap if both timestamps exist
														let timeGap = null;
														let isLongBreak = false;

														if (user.lunchStartTime && user.lunchEndTime) {
															const startTime = new Date(user.lunchStartTime).getTime();
															const endTime = new Date(user.lunchEndTime).getTime();
															const diffInMinutes = Math.round((endTime - startTime) / (1000 * 60));
															timeGap = diffInMinutes;
															isLongBreak = diffInMinutes > 30;
														}

														// Set status style based on status
														let statusBgClass = '';
														let statusTextClass = '';

														if (user.status === "complete") {
															statusBgClass = 'bg-green-100 dark:bg-green-900';
															statusTextClass = 'text-green-800 dark:text-green-200';
														} else if (user.status === "missing both tags") {
															statusBgClass = 'bg-red-100 dark:bg-red-900';
															statusTextClass = 'text-red-800 dark:text-red-200';
														} else if (user.status === "missing #lunchstart") {
															statusBgClass = 'bg-yellow-100 dark:bg-yellow-900';
															statusTextClass = 'text-yellow-800 dark:text-yellow-200';
														} else {
															statusBgClass = 'bg-orange-100 dark:bg-orange-900';
															statusTextClass = 'text-orange-800 dark:text-orange-200';
														}

														// Display text for lunchend status to include lunchover
														const displayStatus = user.status === "missing #lunchend"
															? "missing #lunchend/lunchover"
															: user.status;

														// Format timestamps
														const startTime = user.lunchStartTime
															? new Date(user.lunchStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
															: '-';

														const endTime = user.lunchEndTime
															? new Date(user.lunchEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
															: '-';

														// Row background color for alternating rows
														const rowBgClass = index % 2 === 0 ? 'bg-gray-50 dark:bg-gray-900/50' : 'bg-white dark:bg-gray-800';

														return (
															<tr key={user.id} className={rowBgClass}>
																<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
																	{user.name}
																	{/* Show times on mobile */}
																	{(user.lunchStartTime || user.lunchEndTime) && (
																		<div className="sm:hidden mt-1 text-xs text-gray-500 dark:text-gray-400">
																			{user.lunchStartTime && <div>Start: {startTime}</div>}
																			{user.lunchEndTime && <div>End: {endTime}</div>}
																		</div>
																	)}
																</td>
																<td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">
																	{user.id}
																</td>
																<td className="px-6 py-4 whitespace-nowrap text-sm">
																	<span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBgClass} ${statusTextClass}`}>
																		{displayStatus}
																	</span>
																</td>
																<td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
																	{startTime}
																</td>
																<td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
																	{endTime}
																</td>
																<td className="px-6 py-4 whitespace-nowrap text-sm">
																	{timeGap !== null ? (
																		<span className={isLongBreak
																			? 'text-red-600 dark:text-red-400 font-medium'
																			: 'text-green-600 dark:text-green-400'
																		}>
																			{timeGap} min {isLongBreak ? '⚠️' : '✅'}
																		</span>
																	) : (
																		'-'
																	)}
																</td>
															</tr>
														);
													})}
											</tbody>
										</table>
									</div>
								</div>
							)
						}
					]);
				}
				else if (data.functionCall.name === 'getSlackUpdateStatus') {
					// Handle Slack update status function
					const result = data.functionCall.result as SlackUpdateReport;

					// Add assistant message with the update status table
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'assistant',
							content: '',
							timestamp: Date.now(),
							customContent: (
								<div className="w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
									{/* Header */}
									<div className="bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
										<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
											Update Status for #{result.channel} ({result.timeframe})
										</h3>
										<div className="mt-2 flex flex-wrap gap-2">
											<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
												Users with updates: {result.users.filter(user => user.name !== "checkbot" && user.hasPosted).length}
											</span>
											<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
												Total updates: {result.users.reduce((count, user) =>
													user.name !== "checkbot" && user.allUpdates ? count + user.allUpdates.length : count, 0)}
											</span>
										</div>
									</div>

									{/* Table */}
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
											<thead className="bg-gray-50 dark:bg-gray-900">
												<tr>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
													<th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ID</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Posted At</th>
												</tr>
											</thead>
											<tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
												{/* Get all updates from all users */}
												{result.users
													// Filter out users with name "checkbot" and only show users with updates
													.filter(user => user.name !== "checkbot" && user.hasPosted && user.allUpdates)
													// Sort users by name
													.sort((a, b) => a.name.localeCompare(b.name))
													.flatMap((user) => {
														// For each user, create a row for each update
														return user.allUpdates!.map((update, updateIndex) => {
															// Format timestamp
															const postedTime = update.timestamp
																? new Date(update.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
																: '-';

															// Row background for alternating users
															const baseRowBgClass = updateIndex % 2 === 0
																? 'bg-gray-50 dark:bg-gray-900/50'
																: 'bg-white dark:bg-gray-800';

															// Different shade for first row of each user to help visually group updates
															const rowBgClass = updateIndex === 0
																? `${baseRowBgClass} border-t-2 border-gray-300 dark:border-gray-600`
																: baseRowBgClass;

															return (
																<tr
																	key={`${user.id}-${updateIndex}`}
																	className={`${rowBgClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700`}
																	onClick={() => {
																		if (update.content) {
																			setSelectedContent({
																				name: `${user.name} (Update ${updateIndex + 1})`,
																				content: update.content
																			});
																		}
																	}}
																>
																	<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
																		{user.name}
																		{updateIndex > 0 ? (
																			<span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
																				(Update {updateIndex + 1})
																			</span>
																		) : null}
																	</td>
																	<td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">
																		{user.id}
																	</td>
																	<td className="px-6 py-4 whitespace-nowrap text-sm">
																		<span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
																			Posted Update
																		</span>
																	</td>
																	<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
																		{postedTime}
																	</td>
																</tr>
															);
														});
													})}
											</tbody>
										</table>
									</div>
								</div>
							)
						}
					]);
				}
				else if (data.functionCall.name === 'getSlackReportStatus') {
					// Handle Slack report status function
					const result = data.functionCall.result as SlackReportStatusReport;

					// Add assistant message with the report status table
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'assistant',
							content: '',
							timestamp: Date.now(),
							customContent: (
								<div className="w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
									{/* Header */}
									<div className="bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
										<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
											Report Status for #{result.channel} ({result.timeframe})
										</h3>
										<div className="mt-2 flex flex-wrap gap-2">
											<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
												Users with reports: {result.users.filter(user => user.name !== "checkbot" && user.hasPosted).length}
											</span>
											<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
												Total reports: {result.users.reduce((count, user) =>
													user.name !== "checkbot" && user.allReports ? count + user.allReports.length : count, 0)}
											</span>
										</div>
									</div>

									{/* Table */}
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
											<thead className="bg-gray-50 dark:bg-gray-900">
												<tr>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
													<th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ID</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
													<th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Posted At</th>
												</tr>
											</thead>
											<tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
												{/* Get all reports from all users */}
												{result.users
													// Filter out users with name "checkbot" and only show users with reports
													.filter(user => user.name !== "checkbot" && user.hasPosted && user.allReports)
													// Sort users by name
													.sort((a, b) => a.name.localeCompare(b.name))
													.flatMap((user) => {
														// For each user, create a row for each report
														return user.allReports!.map((report, reportIndex) => {
															// Format timestamp
															const postedTime = report.timestamp
																? new Date(report.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
																: '-';

															// Row background for alternating users
															const baseRowBgClass = reportIndex % 2 === 0
																? 'bg-gray-50 dark:bg-gray-900/50'
																: 'bg-white dark:bg-gray-800';

															// Different shade for first row of each user to help visually group reports
															const rowBgClass = reportIndex === 0
																? `${baseRowBgClass} border-t-2 border-gray-300 dark:border-gray-600`
																: baseRowBgClass;

															return (
																<tr
																	key={`${user.id}-${reportIndex}`}
																	className={`${rowBgClass} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700`}
																	onClick={() => {
																		if (report.content) {
																			setSelectedContent({
																				name: `${user.name} (Report ${reportIndex + 1})`,
																				content: report.content
																			});
																		}
																	}}
																>
																	<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
																		{user.name}
																		{reportIndex > 0 ? (
																			<span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
																				(Report {reportIndex + 1})
																			</span>
																		) : null}
																	</td>
																	<td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">
																		{user.id}
																	</td>
																	<td className="px-6 py-4 whitespace-nowrap text-sm">
																		<span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
																			Posted Report
																		</span>
																	</td>
																	<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
																		{postedTime}
																	</td>
																</tr>
															);
														});
													})}
											</tbody>
										</table>
									</div>
								</div>
							)
						}
					]);
				}
				else {
					setMessages(prev => [
						...prev,
						{
							id: Date.now().toString(),
							role: 'assistant',
							content: data.content,
							timestamp: Date.now(),
						},
					]);
				}
			} else {
				// Normal message
				setMessages(prev => [
					...prev,
					{
						id: Date.now().toString(),
						role: 'assistant',
						content: data.content,
						timestamp: Date.now(),
					},
				]);
			}
		} catch (error) {
			console.error('Full error details:', error);
			setMessages(prev => [
				...prev,
				{
					id: Date.now().toString(),
					role: 'assistant',
					content: `Error: ${error instanceof Error ? error.message : 'An error occurred while processing your request.'}`,
					timestamp: Date.now(),
				},
			]);
		} finally {
			setIsLoading(false);
		}
	};

	const handleRemoveFile = async (fileId: string) => {
		try {
			// Remove file from Pinecone
			const response = await fetch('/api/delete-file', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ fileId }),
			});

			if (!response.ok) {
				throw new Error('Failed to delete file');
			}

			// Remove file from local state
			setFiles(prevFiles => prevFiles.filter(file => file.id !== fileId));

			// Add system message about file removal
			setMessages(prev => [
				...prev,
				{
					id: Date.now().toString(),
					role: 'system',
					content: 'File removed successfully. You can continue chatting with the remaining files.',
					timestamp: Date.now(),
				},
			]);
		} catch (error) {
			console.error('Error removing file:', error);
			setMessages(prev => [
				...prev,
				{
					id: Date.now().toString(),
					role: 'system',
					content: 'Failed to remove file. Please try again.',
					timestamp: Date.now(),
				},
			]);
		}
	};

	useEffect(() => {
		if (chatContainerRef.current) {
			chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
		}
	}, [messages]);

	useEffect(() => {
		// Setup Pinecone index when component mounts
		const setupPinecone = async () => {
			try {
				const response = await fetch('/api/setup-pinecone', {
					method: 'POST',
				});
				const data = await response.json();

				if (!response.ok) {
					throw new Error(data.details || data.error || 'Failed to setup Pinecone index');
				}
				console.log('Pinecone index setup completed');
			} catch (error) {
				console.error('Error setting up Pinecone:', error);
				setMessages(prev => [...prev, {
					id: Date.now().toString(),
					role: 'system',
					content: `Error setting up Pinecone: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your environment variables and try again.`,
					timestamp: Date.now(),
				}]);
			}
		};

		setupPinecone();
	}, []);

	// Add useEffect for PDF.js initialization
	useEffect(() => {
		const initPdfJs = async () => {
			try {
				setIsPdfLibLoading(true);
				// Load PDF.js script
				const script = document.createElement('script');
				script.src = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
				script.async = true;

				script.onload = () => {
					// Set up the worker
					window.pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
					setIsPdfLibLoaded(true);
					setIsPdfLibLoading(false);
					console.log('PDF.js library loaded successfully');
				};

				script.onerror = (error) => {
					console.error('Error loading PDF.js:', error);
					setIsPdfLibLoading(false);
					setMessages(prev => [...prev, {
						id: Date.now().toString(),
						role: 'system',
						content: 'Error loading PDF.js library. Please refresh the page.',
						timestamp: Date.now(),
					}]);
				};

				document.head.appendChild(script);
			} catch (error) {
				console.error('Error initializing PDF.js:', error);
				setIsPdfLibLoading(false);
				setMessages(prev => [...prev, {
					id: Date.now().toString(),
					role: 'system',
					content: 'Error initializing PDF.js library. Please refresh the page.',
					timestamp: Date.now(),
				}]);
			}
		};

		initPdfJs();
	}, []);

	return (
		<div className="flex flex-col h-[80vh] max-w-4xl mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
			{/* Theme toggle button */}
			<div className="flex justify-end mb-2 space-x-2">
				<Link
					href="/admin"
					className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
					aria-label="Admin Dashboard"
				>
					<Settings className="h-5 w-5 text-gray-700 dark:text-gray-300" />
				</Link>
				<button
					onClick={toggleTheme}
					className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
					aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
				>
					{theme === 'light' ? (
						<Moon className="h-5 w-5 text-gray-700" />
					) : (
						<Sun className="h-5 w-5 text-gray-300" />
					)}
				</button>
			</div>

			<div
				ref={chatContainerRef}
				className="flex-1 overflow-y-auto space-y-4 p-4 border border-gray-300 rounded-lg mb-4 bg-gray-50 dark:bg-gray-900 dark:border-gray-700 shadow-sm"
			>
				{messages.length === 0 && (
					<div className="text-center text-gray-600 dark:text-gray-400">
						{isPdfLibLoading ? (
							<div className="flex items-center justify-center space-x-2">
								<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
								<span>Loading PDF support...</span>
							</div>
						) : (
							'Click the plus icon to upload a document and ask questions about its content.'
						)}
					</div>
				)}
				{messages.map((message) => (
					<div
						key={message.id}
						className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'
							}`}
					>
						<div
							className={`${message.customContent ? 'w-full max-w-full' : 'max-w-[80%]'} rounded-lg p-3 shadow-sm ${message.role === 'user'
								? 'bg-indigo-600 text-white'
								: message.role === 'system'
									? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600'
									: 'bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
								}`}
						>
							{message.customContent ? (
								<div className="custom-content">{message.customContent}</div>
							) : (
								<p className="" dangerouslySetInnerHTML={{ __html: message.content }} />
							)}
							<span className="text-xs opacity-70 mt-1 block">
								{new Date(message.timestamp).toLocaleTimeString()}
							</span>
						</div>
					</div>
				))}
				{isLoading && (
					<div className="flex justify-start">
						<div className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
							Thinking...
						</div>
					</div>
				)}
			</div>
{/* ////////////////////////////// */}
			<div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 shadow-sm rounded-lg">
				<form onSubmit={handleSubmit} className="flex items-center space-x-2">
					<button
						type="button"
						onClick={() => setIsUploadModalOpen(true)}
						className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded-full transition-colors text-indigo-600 dark:text-indigo-400"
						title="Upload files"
						disabled={isPdfLibLoading}
					>
						<Plus className="h-5 w-5" />
					</button>
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Type your message..."
						className="flex-1 p-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-500 dark:placeholder:text-gray-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
						disabled={isProcessing}
					/>
					<button
						type="submit"
						disabled={isProcessing || !input.trim()}
						className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
					>
						Send
					</button>
				</form>
			</div>

			<FileUploadModal
				isOpen={isUploadModalOpen}
				onClose={() => setIsUploadModalOpen(false)}
				files={files}
				onFileUpload={handleFileUpload}
				onFileRemove={handleRemoveFile}
				isPdfLibLoading={isPdfLibLoading}
			/>

			{/* Content Popup */}
			{selectedContent && (
				<div className="fixed inset-0 bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-lg w-full mx-4 p-2">
						<div className="flex justify-between items-center mb-4">
							<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
								{selectedContent.name}'s content
							</h3>
							<button
								onClick={() => setSelectedContent(null)}
								className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
							>
								<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg max-h-96 overflow-y-auto">
							<p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{selectedContent.content}</p>
						</div>
						<div className="mt-4 text-right">
						</div>
					</div>
				</div>
			)}
		</div>
	);
}