/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#136dec",
        "background-light": "#f6f7f8",
        "background-dark": "#101822",
        "card-dark": "#1c242e",
        "border-dark": "#282f39",
        ocean: {
          50: "#eaf5f8",
          100: "#cae6ee",
          300: "#70b4c8",
          500: "#2a7d97",
          700: "#1f4f66",
          900: "#183649"
        }
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      boxShadow: {
        panel: "0 12px 36px rgba(24, 54, 73, 0.12)"
      }
    }
  },
  plugins: []
};
