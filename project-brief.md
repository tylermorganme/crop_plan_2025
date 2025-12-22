Project Brief: Real-Time Resource Gantt Chart for Google Sheets
1. Project Overview
We are building a Google Sheets Editor Add-on that visualizes resource allocation in real-time. The core function is taking data from the sheet (Resource Name, Start Date, End Date) and rendering a live Gantt Chart in a sidebar overlay.

We have specific architectural requirements to ensure the app is performant, scalable, and ready for future monetization.

2. Technical Architecture (Mandatory Approach)
We have already assessed the feasibility of Google’s API limits and determined the following architecture is required:

A. The "Polling" Engine (For Real-Time Data)
We are not using standard onEdit triggers or external webhooks, as these are too slow or unreliable for our "dual-monitor" use case.

The Requirement: The sidebar must use a client-side polling mechanism (JavaScript interval) that requests data from the sheet every ~1 second.

The Goal: This allows a user to edit dates on Monitor 1 and see the Gantt Chart move instantly on Monitor 2 (where the sidebar is open).

Why: This bypasses the strict 60/reads/minute external API quota by using the internal google.script.run method, which has much higher limits.

B. Privacy & Permissions Scope
The Constraint: The app must be built using the currentonly OAuth scope (https://www.googleapis.com/auth/spreadsheets.currentonly).

Why: We intend to publish this to the Workspace Marketplace later. Using strict scopes avoids the costly ($1,500+) and slow (4-6 weeks) security assessment from Google. The app should only have permission to touch the specific sheet it is open in.

3. The Feature Set (Prototype)
Input Data
The add-on should read three specific columns (mapping should be configurable or auto-detected based on headers):

Resource ID: (e.g., "Truck 1", "Developer A")

Start Date: (DateTime)

End Date: (DateTime)

Visualization (The Sidebar)
Implement a Gantt Chart library (e.g., Chart.js, Vis.js, or Google Charts Gantt).

The chart must handle overlapping schedules visually.

Responsive: It must look good within the 300px-400px wide sidebar but also scale if the user views it in a full-screen web app deployment.

4. Development & Licensing Strategy
We need a "Marketplace-Ready" structure, even though we are starting with a private prototype.

A. Deployment Workflow
Do not "Publish" the app yet.

Use the "Test Deployment" feature in Google Apps Script. This allows us to install the add-on on our internal accounts for testing across multiple sheets without waiting for Google's review team.

B. Licensing "Skeleton"
We plan to sell this product later (likely via Gumroad or Stripe). For this prototype, we need a Gatekeeper Function built into the server-side code:

The Check: When the sidebar loads, check the user's email (Session.getEffectiveUser().getEmail()).

The Logic:

If Email == [MyEmail], unlock the app (Developer Bypass).

If Email != [MyEmail], show a "License Required" paywall screen.

Future-Proofing: This function should be modular so we can easily swap in an API call to a license server later.


Shutterstock
Explore
5. Deliverables
Source Code: Code.gs (Server logic), Sidebar.html (Client UI), and appsscript.json (Manifest).

Installation Guide: Short instructions on how to paste the code and create a "Test Deployment."

Demo Sheet: A Google Sheet with sample data populated and the script attached.