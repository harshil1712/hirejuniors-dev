export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">Resources</h3>
            <ul className="mt-4 space-y-4">
              <li><a href="#" className="text-base text-gray-400 hover:text-white">Blog</a></li>
              <li><a href="#" className="text-base text-gray-400 hover:text-white">Guides</a></li>
              <li><a href="#" className="text-base text-gray-400 hover:text-white">FAQ</a></li>
            </ul>
          </div>
          {/* <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">Legal</h3>
            <ul className="mt-4 space-y-4">
              <li><a href="#" className="text-base text-gray-400 hover:text-white">Privacy Policy</a></li>
              <li><a href="#" className="text-base text-gray-400 hover:text-white">Terms of Service</a></li>
            </ul>
          </div> */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider">Connect</h3>
            <ul className="mt-4 space-y-4">
              <li><a href="https://x.com/hirejuniors_dev" className="text-base text-gray-400 hover:text-white" target="_blank">X (Twitter)</a></li>
              <li><a href="https://www.linkedin.com/company/hire-juniors-dev/" className="text-base text-gray-400 hover:text-white" target="_blank">LinkedIn</a></li>
              <li><a href="https://github.com/harshil1712/hirejuniors-dev" className="text-base text-gray-400 hover:text-white" target="_blank">GitHub</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-700 pt-8 md:flex md:items-center md:justify-between">
          <p className="text-base text-gray-400">&copy; 2025 HireJuniors.dev</p>
        </div>
      </div>
    </footer>
  )
}
