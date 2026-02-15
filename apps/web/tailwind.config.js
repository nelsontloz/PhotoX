/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: "#eaf5f8",
          100: "#cae6ee",
          300: "#70b4c8",
          500: "#2a7d97",
          700: "#1f4f66",
          900: "#183649"
        }
      },
      boxShadow: {
        panel: "0 12px 36px rgba(24, 54, 73, 0.12)"
      }
    }
  },
  plugins: []
};
