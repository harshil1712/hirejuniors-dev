import { useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'
import type { Job } from '~/database/schema'

export default function JobListings({ jobs }: { jobs: Job[] }) {
  const [filter, setFilter] = useState('All')

  const filteredJobs = filter === 'All' ? jobs : jobs.filter(job => job.jobType === filter)

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h2 className="text-3xl font-extrabold text-white mb-6">Latest Job Openings</h2>
      {/* <div className="mb-6 space-x-2">
        <Button
          onClick={() => setFilter('All')}
          variant={filter === 'All' ? 'default' : 'outline'}
          className={filter === 'All' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-gray-300 border-gray-700 hover:bg-gray-800'}
        >
          All
        </Button>
        <Button
          onClick={() => setFilter('full-time')}
          variant={filter === 'Full-time' ? 'default' : 'outline'}
          className={filter === 'Full-time' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-gray-300 border-gray-700 hover:bg-gray-800'}
        >
          Full-time
        </Button>
        <Button
          onClick={() => setFilter('part-time')}
          variant={filter === 'Intern' ? 'default' : 'outline'}
          className={filter === 'Intern' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-gray-300 border-gray-700 hover:bg-gray-800'}
        >
          Intern
        </Button>
      </div> */}
      <div className="space-y-6">
        {filteredJobs.map((job) => (
          <Card key={job.id} className="bg-gray-800 border-gray-700">
            <CardHeader className="flex flex-row items-center space-x-4 pb-4">
              <div className="bg-white p-2 rounded-full w-[60px] h-[60px] flex items-center justify-center">
                <img
                  src={job.company.logo}
                  alt={`${job.company.name} logo`}
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
              <div>
                <CardTitle className="text-xl text-white">{job.title}</CardTitle>
                <CardDescription className="text-gray-400">{job.company.name}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-400 mb-2">{job.city}, {job.countryCode} • {job.jobType}</p>
              <p className="text-gray-300 mb-4">{job.description}</p>
              <div className="flex flex-wrap gap-2">
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700"><a href={job.companyListingUrl} target='_blank'>Apply Now</a></Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
