import { Button } from './ui/button'

export default function Header() {
  return (
    <header className="bg-gray-900 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-6 md:justify-start md:space-x-10">
          <div className="flex justify-start lg:w-0 lg:flex-1">
            <a href="/" className="text-2xl font-bold text-white">
              HireJuniors<span className='text-base font-normal'>.dev</span>
            </a>
          </div>
          <nav className="hidden md:flex space-x-10">
            <a href="/" className="text-base font-medium text-gray-300 hover:text-white">
              Find Jobs
            </a>
            <a href="#" className="text-base font-medium text-gray-300 hover:text-white">
              Companies
            </a>
            {/* <a href="#" className="text-base font-medium text-gray-300 hover:text-white">
              Resources
            </a> */}
          </nav>
          <div className="hidden md:flex items-center justify-end md:flex-1 lg:w-0">
            {/* <Button variant="ghost" className="text-gray-300 hover:text-white">
              Sign in
            </Button>
            <Button className="ml-8 whitespace-nowrap inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-emerald-600 hover:bg-emerald-700">
              Post a job
            </Button> */}
          </div>
        </div>
      </div>
    </header>
  )
}
