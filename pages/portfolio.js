export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/",
      permanent: true
    }
  };
}

export default function PortfolioRedirect() {
  return null;
}
