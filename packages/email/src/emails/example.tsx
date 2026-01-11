import { Body, Container, Head, Html, Preview, Tailwind, Text } from '@react-email/components'

type Props = {
  name: string
}

export function ExampleEmail({ name }: Props) {
  const previewText = `Hello ${name}`

  return (
    <Html>
      <Head />

      <Preview>{previewText}</Preview>

      <Tailwind>
        <Body className='mx-auto my-auto bg-white px-2 font-sans'>
          <Container className='mx-auto my-[40px] max-w-[465px] rounded border border-[#eaeaea] border-solid p-[20px]'>
            <Text>Hello {name},</Text>

            <Text>Text here</Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

ExampleEmail.PreviewProps = {
  name: 'Sanny Sherief',
} as Props

export default ExampleEmail
