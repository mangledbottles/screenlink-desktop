import screenlinkLogo from "../assets/screenlink.svg";

export default function SignIn() {
  return (
    <>
      <div className="flex min-h-full flex-1 flex-col justify-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <img
            className="mx-auto h-10 w-auto"
            src={screenlinkLogo}
            alt="ScreenLink"
          />
          <h2 className="mt-10 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
            Login to get started
          </h2>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
          <div>
            <button
              type="submit"
              className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              onClick={() => window.electron.openNewDevice()}
            >
              Sign in on web
            </button>
          </div>

          <p className="mt-10 text-center text-sm text-gray-500">
            Don't have an account?{" "}
            <a className="font-semibold leading-6 text-indigo-600 hover:text-indigo-500">
              Create a free account
            </a>
          </p>
        </div>
      </div>
    </>
  );
}