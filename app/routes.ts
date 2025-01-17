import { type RouteConfig, index, prefix, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	...prefix('api', [
		route('company', './routes/api/company.ts'),
		route('job', './routes/api/job.ts'),
	]
	)] satisfies RouteConfig;
