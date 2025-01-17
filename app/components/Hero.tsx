import { useState } from 'react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Search } from 'lucide-react'

export default function Hero() {
  const [searchTerm, setSearchTerm] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    console.log('Searching for:', searchTerm)
    // Implement search functionality here
  }

  return (
    <div className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
          Find Your Dream Tech Job
        </h1>
        <p className="mt-6 max-w-3xl text-xl">
          Discover early job opportunities at various companies and startups.
        </p>
        <form onSubmit={handleSearch} className="mt-8 sm:flex">
          <div className="flex-1">
            <Input
              type="text"
              placeholder="Search jobs, companies, or keywords"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-5 py-3 text-base text-white placeholder-gray-400 bg-gray-800 border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div className="mt-3 sm:mt-0 sm:ml-3">
            <Button type="submit" className="w-full flex items-center justify-center px-5 py-3 border border-transparent text-base font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-emerald-500">
              <Search className="w-5 h-5 mr-2" />
              Search
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
